//! Embedded SSH client (russh) — see docs/embedded-ssh-plan.md.
//!
//! An embedded SSH session is just another byte-pipe producer for the relay
//! hub: the shell channel's halves are adapted into the blocking
//! `Read`/`Write` pair `register_session` expects, so the frontend, dead-mode
//! reconnect, and AI sharing work unchanged. Auth secrets and host-key
//! confirmations reach the frontend through events + response commands
//! (the `Prompter` seam below); tests inject an auto-approving prompter.

use std::collections::HashMap;
use std::future::Future;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use russh::client::{self, Handle};
use russh::keys::ssh_key;
use russh::keys::PrivateKeyWithHashAlg;
use russh::ChannelWriteHalf;
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};

use crate::relay::{register_session, ReconnectHooks, SessionIo, WsHub};
use crate::state::{AppState, SessionState, WsConnectResult};

pub type BoxFuture<T> = Pin<Box<dyn Future<Output = T> + Send>>;

// ── Frontend prompt plumbing ─────────────────────────────────────────

#[derive(Clone, Serialize)]
pub struct HostKeyPrompt {
    pub host: String,
    pub port: u16,
    pub key_type: String,
    pub fingerprint: String,
    // true = a DIFFERENT key is recorded for this host (possible MITM);
    // false = first time we see this host.
    pub mismatch: bool,
}

/// User interaction needed mid-handshake. Production: frontend dialogs.
/// Tests: auto-approve.
pub trait Prompter: Send + Sync {
    /// Ask for a password/passphrase. None = user cancelled (abort connect).
    fn ask_secret(&self, kind: &str, prompt: String) -> BoxFuture<Option<String>>;
    /// Confirm an unknown or changed host key.
    fn confirm_host_key(&self, info: HostKeyPrompt) -> BoxFuture<bool>;
}

pub enum PromptAnswer {
    Secret(Option<String>),
    Accept(bool),
}

pub type PendingPrompts = Arc<Mutex<HashMap<u64, tokio::sync::oneshot::Sender<PromptAnswer>>>>;

static NEXT_PROMPT: AtomicU64 = AtomicU64::new(1);

/// Production prompter: emits a Tauri event and parks until the matching
/// `ssh_auth_response` / `ssh_hostkey_response` command arrives.
pub struct FrontendPrompter {
    hub: Arc<WsHub>,
    pending: PendingPrompts,
}

impl FrontendPrompter {
    pub fn new(hub: Arc<WsHub>, pending: PendingPrompts) -> Self {
        Self { hub, pending }
    }

    fn park<T: Send + 'static>(&self, event: &str, payload: serde_json::Value, wrap: fn(PromptAnswer) -> Option<T>) -> BoxFuture<Option<T>> {
        let req_id = NEXT_PROMPT.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = tokio::sync::oneshot::channel::<PromptAnswer>();
        if let Ok(mut map) = self.pending.lock() {
            map.insert(req_id, tx);
        }
        let mut body = payload;
        body["reqId"] = serde_json::json!(req_id);
        let sent = self.hub.emit(event, body).is_ok();
        let pending = self.pending.clone();
        Box::pin(async move {
            if !sent {
                return None;
            }
            let answer = rx.await.ok();
            if let Ok(mut map) = pending.lock() {
                map.remove(&req_id);
            }
            answer.and_then(wrap)
        })
    }
}

impl Prompter for FrontendPrompter {
    fn ask_secret(&self, kind: &str, prompt: String) -> BoxFuture<Option<String>> {
        self.park::<String>(
            "ssh-auth-request",
            serde_json::json!({ "kind": kind, "prompt": prompt }),
            |a| match a {
                PromptAnswer::Secret(s) => s,
                _ => None,
            },
        )
    }

    fn confirm_host_key(&self, info: HostKeyPrompt) -> BoxFuture<bool> {
        let fut = self.park::<bool>(
            "ssh-hostkey-request",
            serde_json::to_value(&info).unwrap_or_default(),
            |a| match a {
                PromptAnswer::Accept(b) => Some(b),
                _ => None,
            },
        );
        Box::pin(async move { fut.await.unwrap_or(false) })
    }
}

#[tauri::command]
pub fn ssh_auth_response(state: tauri::State<AppState>, req_id: u64, secret: Option<String>) -> Result<(), String> {
    let tx = state
        .pending_prompts
        .lock()
        .map_err(|e| e.to_string())?
        .remove(&req_id);
    if let Some(tx) = tx {
        let _ = tx.send(PromptAnswer::Secret(secret));
    }
    Ok(())
}

#[tauri::command]
pub fn ssh_hostkey_response(state: tauri::State<AppState>, req_id: u64, accept: bool) -> Result<(), String> {
    let tx = state
        .pending_prompts
        .lock()
        .map_err(|e| e.to_string())?
        .remove(&req_id);
    if let Some(tx) = tx {
        let _ = tx.send(PromptAnswer::Accept(accept));
    }
    Ok(())
}

// ── Session state ────────────────────────────────────────────────────

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmbeddedSshSpec {
    pub hostname: String,
    pub port: u16,
    pub user: String,
    pub identity_file: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForwardInfo {
    pub forward_id: u64,
    pub kind: String, // "local" | "remote"
    pub listen_host: String,
    pub listen_port: u16,
    pub target_host: String,
    pub target_port: u16,
}

pub(crate) struct ForwardEntry {
    pub info: ForwardInfo,
    // Local forwards run a listener task we can abort; remote forwards are
    // cancelled through the session handle (cancel_tcpip_forward).
    pub abort: Option<tauri::async_runtime::JoinHandle<()>>,
}

pub(crate) struct SshLive {
    handle: Arc<Handle<SshHandler>>,
    shell_writer: Arc<ChannelWriteHalf<client::Msg>>,
}

/// All fields are Arc-shared, so cloning is cheap and shares live state —
/// the respawn path and the forward commands hold their own copies.
#[derive(Clone)]
pub struct SshSession {
    pub(crate) cancel: Arc<AtomicBool>,
    // Notified to stop bridge/listener tasks without waiting out timeouts.
    pub(crate) close_notify: Arc<tokio::sync::Notify>,
    pub(crate) live: Arc<tokio::sync::Mutex<Option<SshLive>>>,
    pub(crate) size: Arc<Mutex<(u32, u32)>>, // (cols, rows)
    pub(crate) spec: EmbeddedSshSpec,
    // Password that already worked once — lets dead-mode respawn re-auth
    // without a dialog. In memory only, dropped with the tab.
    pub(crate) cached_password: Arc<Mutex<Option<String>>>,
    pub(crate) forwards: Arc<Mutex<HashMap<u64, ForwardEntry>>>,
    pub(crate) next_forward: Arc<AtomicU64>,
}

// ── Host key verification ────────────────────────────────────────────

fn known_hosts_path() -> Option<PathBuf> {
    crate::ssh::ssh_config_path().map(|p| p.with_file_name("known_hosts"))
}

/// Drop every non-comment line naming `host` (or `[host]:port`) so a
/// changed key can be re-learned cleanly.
fn remove_known_host(path: &PathBuf, host: &str, port: u16) -> Result<(), String> {
    let content = match std::fs::read_to_string(path) {
        Ok(c) => c,
        Err(_) => return Ok(()), // nothing to remove
    };
    let plain = host.to_string();
    let bracketed = format!("[{}]:{}", host, port);
    let kept: Vec<&str> = content
        .lines()
        .filter(|line| {
            let first = line.split_whitespace().next().unwrap_or("");
            first != plain && first != bracketed
        })
        .collect();
    std::fs::write(path, kept.join("\n") + "\n").map_err(|e| e.to_string())
}

// ── russh client handler ─────────────────────────────────────────────

pub struct SshHandler {
    host: String,
    port: u16,
    prompter: Arc<dyn Prompter>,
    known_hosts: Option<PathBuf>,
    forwards: Arc<Mutex<HashMap<u64, ForwardEntry>>>,
}

impl client::Handler for SshHandler {
    type Error = russh::Error;

    async fn check_server_key(&mut self, key: &ssh_key::PublicKey) -> Result<bool, Self::Error> {
        let path = match &self.known_hosts {
            Some(p) => p.clone(),
            None => return Ok(false), // no home dir — refuse rather than trust blindly
        };
        let fingerprint = key.fingerprint(ssh_key::HashAlg::Sha256).to_string();
        let key_type = key.algorithm().to_string();
        let prompt = |mismatch: bool| HostKeyPrompt {
            host: self.host.clone(),
            port: self.port,
            key_type: key_type.clone(),
            fingerprint: fingerprint.clone(),
            mismatch,
        };
        match russh::keys::known_hosts::check_known_hosts_path(&self.host, self.port, key, &path) {
            Ok(true) => Ok(true),
            Ok(false) => {
                // First contact (or key type not yet recorded): TOFU dialog.
                if !self.prompter.confirm_host_key(prompt(false)).await {
                    return Ok(false);
                }
                Ok(russh::keys::known_hosts::learn_known_hosts_path(&self.host, self.port, key, &path).is_ok())
            }
            Err(russh::keys::Error::KeyChanged { .. }) => {
                if !self.prompter.confirm_host_key(prompt(true)).await {
                    return Ok(false);
                }
                if remove_known_host(&path, &self.host, self.port).is_err() {
                    return Ok(false);
                }
                Ok(russh::keys::known_hosts::learn_known_hosts_path(&self.host, self.port, key, &path).is_ok())
            }
            Err(_) => Ok(false),
        }
    }

    /// Server-side socket opened for a remote (-R) forward: connect the
    /// mapped local target and bridge the two.
    async fn server_channel_open_forwarded_tcpip(
        &mut self,
        channel: russh::Channel<client::Msg>,
        _connected_address: &str,
        connected_port: u32,
        _originator_address: &str,
        _originator_port: u32,
        reply: client::ChannelOpenHandle,
        _session: &mut client::Session,
    ) -> Result<(), Self::Error> {
        reply.accept().await;
        let target = self
            .forwards
            .lock()
            .ok()
            .and_then(|t| {
                t.values()
                    .find(|f| f.info.kind == "remote" && f.info.listen_port as u32 == connected_port)
                    .map(|f| (f.info.target_host.clone(), f.info.target_port))
            });
        if let Some((host, port)) = target {
            tauri::async_runtime::spawn(async move {
                match tokio::net::TcpStream::connect((host.as_str(), port)).await {
                    Ok(stream) => bridge_tcp_channel(stream, channel).await,
                    Err(_) => {}
                }
            });
        }
        Ok(())
    }
}

// ── TCP <-> channel bridging (port forwarding) ───────────────────────

/// Pump bytes both ways between a plain TCP stream and an SSH channel
/// (direct-tcpip or forwarded-tcpip). Returns when either side ends.
/// Generic so the in-process test server can reuse it for its own channels.
async fn bridge_tcp_channel<S>(stream: tokio::net::TcpStream, channel: russh::Channel<S>)
where
    S: From<(russh::ChannelId, russh::ChannelMsg)> + Send + Sync + 'static,
{
    let (mut ch_read, ch_write) = channel.split();
    let (mut tcp_read, mut tcp_write) = stream.into_split();
    let mut up = tauri::async_runtime::spawn(async move {
        let mut buf = [0u8; 16384];
        loop {
            match tokio::io::AsyncReadExt::read(&mut tcp_read, &mut buf).await {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if ch_write.data_bytes(buf[..n].to_vec()).await.is_err() {
                        break;
                    }
                }
            }
        }
    });
    let mut down = tauri::async_runtime::spawn(async move {
        while let Some(msg) = ch_read.wait().await {
            match msg {
                russh::ChannelMsg::Data { data } => {
                    if tokio::io::AsyncWriteExt::write_all(&mut tcp_write, &data).await.is_err() {
                        break;
                    }
                }
                russh::ChannelMsg::Close | russh::ChannelMsg::Eof => break,
                _ => {}
            }
        }
    });
    // Either direction ending tears the bridge down.
    tokio::select! {
        _ = &mut up => down.abort(),
        _ = &mut down => up.abort(),
    }
}

// ── Shell channel <-> relay bridge ───────────────────────────────────

/// Server output -> relay read loop (mirrors SerialIoReader).
struct SshReader {
    rx: std::sync::mpsc::Receiver<Vec<u8>>,
    cur: std::collections::VecDeque<u8>,
}

impl Read for SshReader {
    fn read(&mut self, out: &mut [u8]) -> std::io::Result<usize> {
        while self.cur.is_empty() {
            match self.rx.recv() {
                Ok(chunk) => self.cur.extend(chunk),
                Err(_) => return Ok(0), // channel closed -> EOF -> dead mode
            }
        }
        let n = self.cur.len().min(out.len());
        for b in out.iter_mut().take(n) {
            *b = self.cur.pop_front().unwrap_or(0);
        }
        Ok(n)
    }
}

/// Keystrokes -> server shell channel (mirrors SerialIoWriter).
struct SshWriter {
    tx: std::sync::mpsc::SyncSender<Vec<u8>>,
}

impl Write for SshWriter {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.tx
            .send(buf.to_vec())
            .map_err(|_| std::io::Error::new(std::io::ErrorKind::BrokenPipe, "ssh session gone"))?;
        Ok(buf.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

// ── Connect + session setup ──────────────────────────────────────────

fn expand_home(path: &str) -> PathBuf {
    if let Some(rest) = path.strip_prefix("~/") {
        if let Some(cfg) = crate::ssh::ssh_config_path() {
            // ssh_config_path is ~/.ssh/config — its grandparent is home.
            if let Some(home) = cfg.parent().and_then(|p| p.parent()) {
                return home.join(rest);
            }
        }
    }
    PathBuf::from(path)
}

fn candidate_key_files(spec: &EmbeddedSshSpec) -> Vec<PathBuf> {
    if let Some(f) = &spec.identity_file {
        return vec![expand_home(f)];
    }
    let home = crate::ssh::ssh_config_path().and_then(|p| p.parent().map(|d| d.to_path_buf()));
    match home {
        Some(ssh_dir) => ["id_ed25519", "id_ecdsa", "id_rsa"]
            .iter()
            .map(|n| ssh_dir.join(n))
            .filter(|p| p.exists())
            .collect(),
        None => vec![],
    }
}

/// Try agent (Pageant on Windows) identities, then identity files, then
/// password. Returns once any method succeeds.
async fn authenticate(
    handle: &mut Handle<SshHandler>,
    spec: &EmbeddedSshSpec,
    prompter: &Arc<dyn Prompter>,
    cached_password: &Arc<Mutex<Option<String>>>,
) -> Result<(), String> {
    // 1. Agent (Pageant on Windows). Absent agent is normal — keep going.
    #[cfg(target_os = "windows")]
    {
        if let Ok(mut agent) = russh::keys::agent::client::AgentClient::connect_pageant().await {
            if let Ok(identities) = agent.request_identities().await {
                for identity in identities {
                    if let russh::keys::agent::AgentIdentity::PublicKey { key, .. } = identity {
                        if let Ok(result) = handle
                            .authenticate_publickey_with(spec.user.clone(), key, None, &mut agent)
                            .await
                        {
                            if result.success() {
                                return Ok(());
                            }
                        }
                    }
                }
            }
        }
    }

    // 2. Identity files.
    let rsa_hash = handle
        .best_supported_rsa_hash()
        .await
        .ok()
        .flatten()
        .flatten();
    for path in candidate_key_files(spec) {
        let key = match russh::keys::load_secret_key(&path, None) {
            Ok(k) => k,
            Err(russh::keys::Error::KeyIsEncrypted) => {
                // Up to 3 passphrase attempts, then move to the next key.
                let mut unlocked = None;
                for _ in 0..3 {
                    let prompt = format!("Enter passphrase for key {}:", path.display());
                    match prompter.ask_secret("passphrase", prompt).await {
                        Some(pp) => match russh::keys::load_secret_key(&path, Some(&pp)) {
                            Ok(k) => {
                                unlocked = Some(k);
                                break;
                            }
                            Err(_) => continue, // wrong passphrase — re-ask
                        },
                        None => break, // cancelled — next auth method
                    }
                }
                match unlocked {
                    Some(k) => k,
                    None => continue,
                }
            }
            Err(_) => continue, // unreadable/corrupt key — next candidate
        };
        let key_with_hash = PrivateKeyWithHashAlg::new(Arc::new(key), rsa_hash);
        match handle
            .authenticate_publickey(spec.user.clone(), key_with_hash)
            .await
        {
            Ok(result) if result.success() => return Ok(()),
            _ => continue,
        }
    }

    // 3. Password: cached (reconnect) first, then up to 3 dialog attempts.
    let cached = cached_password.lock().ok().and_then(|c| c.clone());
    if let Some(pw) = cached {
        if let Ok(r) = handle
            .authenticate_password(spec.user.clone(), pw)
            .await
        {
            if r.success() {
                return Ok(());
            }
        }
        if let Ok(mut c) = cached_password.lock() {
            *c = None; // stale (server rotated credentials) — fall through to prompt
        }
    }
    for _ in 0..3 {
        let prompt = format!("{}@{}'s password:", spec.user, spec.hostname);
        match prompter.ask_secret("password", prompt).await {
            None => return Err("Authentication cancelled".into()),
            Some(pw) => match handle
                .authenticate_password(spec.user.clone(), pw.clone())
                .await
            {
                Ok(r) if r.success() => {
                    if let Ok(mut c) = cached_password.lock() {
                        *c = Some(pw);
                    }
                    return Ok(());
                }
                _ => continue, // wrong password — re-ask
            },
        }
    }
    Err("Authentication failed".into())
}

/// Full lifecycle: TCP connect -> host key -> auth -> pty+shell channel ->
/// bridge tasks. Returns the relay byte pair; the live handle goes into
/// `session.live`. Shared by the initial spawn and the dead-mode respawn.
async fn connect_session(
    session: &SshSession,
    prompter: Arc<dyn Prompter>,
) -> Result<SessionIo, String> {
    connect_session_with(session, prompter, known_hosts_path()).await
}

/// `known_hosts` is injectable so integration tests never touch the user's
/// real file.
async fn connect_session_with(
    session: &SshSession,
    prompter: Arc<dyn Prompter>,
    known_hosts: Option<PathBuf>,
) -> Result<SessionIo, String> {
    let spec = &session.spec;
    let (cols, rows) = session.size.lock().map(|s| *s).unwrap_or((80, 24));

    let mut config = client::Config::default();
    config.inactivity_timeout = None;
    config.keepalive_interval = Some(Duration::from_secs(15));
    config.nodelay = true;

    let handler = SshHandler {
        host: spec.hostname.clone(),
        port: spec.port,
        prompter: prompter.clone(),
        known_hosts,
        forwards: session.forwards.clone(),
    };

    let mut handle = tokio::time::timeout(
        Duration::from_secs(15),
        client::connect(Arc::new(config), (spec.hostname.as_str(), spec.port), handler),
    )
    .await
    .map_err(|_| format!("Connection to {} timed out", spec.hostname))?
    .map_err(|e| format!("SSH handshake with {} failed: {}", spec.hostname, e))?;

    authenticate(&mut handle, spec, &prompter, &session.cached_password).await?;

    let channel = handle
        .channel_open_session()
        .await
        .map_err(|e| format!("Failed to open session channel: {e}"))?;
    channel
        .request_pty(false, "xterm-256color", cols, rows, 0, 0, &[])
        .await
        .map_err(|e| format!("PTY request failed: {e}"))?;
    channel
        .request_shell(true)
        .await
        .map_err(|e| format!("Shell request failed: {e}"))?;

    let (mut ch_read, ch_write) = channel.split();
    let shell_writer = Arc::new(ch_write);

    // Downstream: channel data -> mpsc -> SshReader -> relay -> xterm.
    let (out_tx, out_rx) = std::sync::mpsc::channel::<Vec<u8>>();
    {
        let notify = session.close_notify.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                tokio::select! {
                    _ = notify.notified() => break,
                    msg = ch_read.wait() => match msg {
                        Some(russh::ChannelMsg::Data { data })
                        | Some(russh::ChannelMsg::ExtendedData { data, .. }) => {
                            if out_tx.send(data.to_vec()).is_err() {
                                break;
                            }
                        }
                        Some(russh::ChannelMsg::Eof) | Some(russh::ChannelMsg::Close) | None => break,
                        _ => {}
                    },
                }
            }
            drop(out_tx); // SshReader EOFs -> relay enters dead mode
        });
    }

    // Upstream: SshWriter -> mpsc -> forwarder thread -> channel.
    // A dedicated std thread because data_bytes is async while the relay
    // writer is blocking (and block_on must never run on a runtime thread).
    let (in_tx, in_rx) = std::sync::mpsc::sync_channel::<Vec<u8>>(64);
    {
        let cancel = session.cancel.clone();
        let wh = shell_writer.clone();
        std::thread::spawn(move || loop {
            match in_rx.recv_timeout(Duration::from_millis(100)) {
                Ok(chunk) => {
                    let fut = wh.data_bytes(chunk);
                    if tauri::async_runtime::block_on(fut).is_err() {
                        break;
                    }
                }
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                    if cancel.load(Ordering::Relaxed) {
                        break;
                    }
                }
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
            }
        });
    }

    // Re-establish port forwardings (no-op on first connect).
    let handle = Arc::new(handle);
    reapply_forwards(&handle, session).await;

    *session.live.lock().await = Some(SshLive { handle, shell_writer });
    Ok((Box::new(SshReader { rx: out_rx, cur: std::collections::VecDeque::new() }), Box::new(SshWriter { tx: in_tx })))
}

/// Re-apply every recorded forwarding after a (re)connect. Listener tasks
/// from a previous life are already dead (their handle was dropped).
async fn reapply_forwards(handle: &Arc<Handle<SshHandler>>, session: &SshSession) {
    let snapshot: Vec<ForwardInfo> = session
        .forwards
        .lock()
        .map(|t| t.values().map(|f| f.info.clone()).collect())
        .unwrap_or_default();
    for info in snapshot {
        match info.kind.as_str() {
            "local" => {
                if let Some(task) = spawn_local_forward(handle, session, &info).await {
                    if let Ok(mut t) = session.forwards.lock() {
                        if let Some(entry) = t.get_mut(&info.forward_id) {
                            entry.abort = Some(task);
                        }
                    }
                }
            }
            "remote" => {
                let _ = handle
                    .tcpip_forward(info.listen_host.clone(), info.listen_port as u32)
                    .await;
            }
            _ => {}
        }
    }
}

/// Bind the local listener for a -L forward and spawn its accept loop.
async fn spawn_local_forward(
    handle: &Arc<Handle<SshHandler>>,
    session: &SshSession,
    info: &ForwardInfo,
) -> Option<tauri::async_runtime::JoinHandle<()>> {
    let listener = tokio::net::TcpListener::bind((info.listen_host.as_str(), info.listen_port)).await.ok()?;
    let handle = handle.clone();
    let notify = session.close_notify.clone();
    let target_host = info.target_host.clone();
    let target_port = info.target_port;
    Some(tauri::async_runtime::spawn(async move {
        loop {
            tokio::select! {
                _ = notify.notified() => break,
                accepted = listener.accept() => {
                    match accepted {
                        Ok((stream, peer)) => {
                            let handle = handle.clone();
                            let th = target_host.clone();
                            tauri::async_runtime::spawn(async move {
                                match handle
                                    .channel_open_direct_tcpip(th, target_port as u32, peer.ip().to_string(), peer.port() as u32)
                                    .await
                                {
                                    Ok(ch) => bridge_tcp_channel(stream, ch).await,
                                    Err(_) => {}
                                }
                            });
                        }
                        Err(_) => break,
                    }
                }
            }
        }
    }))
}

// ── Reconnect hooks (dead mode) ──────────────────────────────────────

fn ssh_hooks(app: tauri::AppHandle, id: String, auto_retry: Arc<AtomicBool>) -> ReconnectHooks {
    let state = app.state::<AppState>();
    let ssh_sessions = state.ssh_sessions.clone();
    let prompter: Arc<dyn Prompter> = Arc::new(FrontendPrompter::new(
        state.hub.clone(),
        state.pending_prompts.clone(),
    ));
    ReconnectHooks {
        auto_retry: Some(auto_retry),
        notice: Box::new(crate::deadmode::disconnect_notice),
        pre_resume: {
            let ssh_sessions = ssh_sessions.clone();
            let id = id.clone();
            Box::new(move || {
                let rows = ssh_sessions
                    .lock()
                    .ok()
                    .and_then(|t| t.get(&id).and_then(|s| s.size.lock().ok().map(|sz| sz.1)))
                    .unwrap_or(24);
                crate::deadmode::resume_scroll(rows as u16)
            })
        },
        on_state: {
            let id = id.clone();
            Box::new(move |alive| {
                let _ = app.emit("session-state", SessionState { id: id.clone(), alive });
            })
        },
        respawn: Box::new(move || {
            let table = ssh_sessions.lock().map_err(|e| e.to_string())?;
            let session = table.get(&id).cloned().ok_or("ssh session gone")?;
            let prompter = prompter.clone();
            drop(table);
            tauri::async_runtime::block_on(async move {
                // Clear the dead handle; reconnect runs fully async but
                // we're on a blocking relay thread.
                *session.live.lock().await = None;
                connect_session(&session, prompter).await
            })
        }),
    }
}

// ── Commands ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn ssh_spawn_embedded(
    state: tauri::State<'_, AppState>,
    app: tauri::AppHandle,
    spec: EmbeddedSshSpec,
) -> Result<WsConnectResult, String> {
    let id = {
        let mut next = state.next_id.lock().map_err(|e| e.to_string())?;
        let id = format!("tab-{}", *next);
        *next += 1;
        id
    };

    let session = SshSession {
        cancel: Arc::new(AtomicBool::new(false)),
        close_notify: Arc::new(tokio::sync::Notify::new()),
        live: Arc::new(tokio::sync::Mutex::new(None)),
        size: Arc::new(Mutex::new((80, 24))),
        spec,
        cached_password: Arc::new(Mutex::new(None)),
        forwards: Arc::new(Mutex::new(HashMap::new())),
        next_forward: Arc::new(AtomicU64::new(1)),
    };

    let prompter: Arc<dyn Prompter> = Arc::new(FrontendPrompter::new(
        state.hub.clone(),
        state.pending_prompts.clone(),
    ));
    let (reader, writer) = connect_session(&session, prompter).await?;

    state
        .ssh_sessions
        .lock()
        .map_err(|e| e.to_string())?
        .insert(id.clone(), session);

    let auto = state.register_auto_reconnect(&id);
    register_session(&state.hub, &id, reader, writer, Some(ssh_hooks(app, id.clone(), auto)))?;
    Ok(state.ws_result(id))
}

/// Resize hook called from pty_resize for embedded SSH sessions.
pub(crate) fn resize_ssh_session(session: &SshSession, cols: u16, rows: u16) {
    if let Ok(mut s) = session.size.lock() {
        *s = (cols as u32, rows as u32);
    }
    let live = session.live.clone();
    tauri::async_runtime::spawn(async move {
        let guard = live.lock().await;
        if let Some(l) = &*guard {
            let _ = l.shell_writer.window_change(cols as u32, rows as u32, 0, 0).await;
        }
    });
}

/// Kill hook called from pty_kill for embedded SSH sessions.
pub(crate) fn kill_ssh_session(session: &SshSession) {
    session.cancel.store(true, Ordering::Relaxed);
    session.close_notify.notify_waiters();
    // Abort local forward listeners.
    if let Ok(mut t) = session.forwards.lock() {
        for (_, f) in t.drain() {
            if let Some(h) = f.abort {
                h.abort();
            }
        }
    }
    // Drop the handle: closes the SSH connection (channels die with it).
    let live = session.live.clone();
    tauri::async_runtime::spawn(async move {
        *live.lock().await = None;
    });
}

/// Core of ssh_forward_add, callable without Tauri state (tests).
async fn add_forward(
    session: &SshSession,
    kind: &str,
    listen_host: String,
    listen_port: u16,
    target_host: String,
    target_port: u16,
) -> Result<u64, String> {
    let forward_id = session.next_forward.fetch_add(1, Ordering::Relaxed);
    let info = ForwardInfo {
        forward_id,
        kind: kind.to_string(),
        listen_host,
        listen_port,
        target_host,
        target_port,
    };

    let abort = match kind {
        "local" => {
            let guard = session.live.lock().await;
            let live = guard.as_ref().ok_or("session not connected")?;
            Some(
                spawn_local_forward(&live.handle, session, &info)
                    .await
                    .ok_or_else(|| format!("Failed to listen on {}:{}", info.listen_host, info.listen_port))?,
            )
        }
        "remote" => {
            let guard = session.live.lock().await;
            let live = guard.as_ref().ok_or("session not connected")?;
            live.handle
                .tcpip_forward(info.listen_host.clone(), info.listen_port as u32)
                .await
                .map_err(|e| format!("Remote forward request failed: {e}"))?;
            None
        }
        _ => return Err("kind must be \"local\" or \"remote\"".into()),
    };

    session
        .forwards
        .lock()
        .map_err(|e| e.to_string())?
        .insert(forward_id, ForwardEntry { info, abort });
    Ok(forward_id)
}

#[tauri::command]
pub async fn ssh_forward_add(
    state: tauri::State<'_, AppState>,
    id: String,
    kind: String,
    listen_host: String,
    listen_port: u16,
    target_host: String,
    target_port: u16,
) -> Result<u64, String> {
    let session = {
        let table = state.ssh_sessions.lock().map_err(|e| e.to_string())?;
        table.get(&id).cloned().ok_or("not an embedded ssh session")?
    };
    add_forward(&session, &kind, listen_host, listen_port, target_host, target_port).await
}

#[tauri::command]
pub async fn ssh_forward_remove(state: tauri::State<'_, AppState>, id: String, forward_id: u64) -> Result<(), String> {
    let session = {
        let table = state.ssh_sessions.lock().map_err(|e| e.to_string())?;
        table.get(&id).cloned().ok_or("not an embedded ssh session")?
    };
    let entry = session
        .forwards
        .lock()
        .map_err(|e| e.to_string())?
        .remove(&forward_id)
        .ok_or("no such forward")?;
    match entry.abort {
        Some(task) => task.abort(),
        None => {
            let guard = session.live.lock().await;
            if let Some(l) = &*guard {
                let _ = l
                    .handle
                    .cancel_tcpip_forward(entry.info.listen_host.clone(), entry.info.listen_port as u32)
                    .await;
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub fn ssh_forward_list(state: tauri::State<AppState>, id: String) -> Result<Vec<ForwardInfo>, String> {
    let table = state.ssh_sessions.lock().map_err(|e| e.to_string())?;
    let session = table.get(&id).ok_or("not an embedded ssh session")?;
    let forwards = session
        .forwards
        .lock()
        .map_err(|e| e.to_string())?
        .values()
        .map(|f| f.info.clone())
        .collect();
    Ok(forwards)
}

// ── Tests ────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use russh::server::{self, Auth, Msg as ServerMsg};

    // Throwaway ed25519 host key for the in-process test server (no rand_core
    // version juggling — generated once via ssh-keygen, used only here).
    const TEST_HOST_KEY: &str = "-----BEGIN OPENSSH PRIVATE KEY-----\n\
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW\n\
QyNTUxOQAAACBO/oBgM4iOWnqOqGVMgnmZRfPLCxMk33OEzaBYgp1/TwAAAJDIoVDeyKFQ\n\
3gAAAAtzc2gtZWQyNTUxOQAAACBO/oBgM4iOWnqOqGVMgnmZRfPLCxMk33OEzaBYgp1/Tw\n\
AAAEC+hE271SLdVSnyiemya1rk9ceBu6KzuKm4kfmYrBc/Ck7+gGAziI5aeo6oZUyCeZlF\n\
88sLEyTfc4TNoFiCnX9PAAAACnR0ZXJtLXRlc3QBAgM=\n\
-----END OPENSSH PRIVATE KEY-----\n";

    /// Auto-approving prompter: password "pw", every host key accepted.
    struct TestPrompter;
    impl Prompter for TestPrompter {
        fn ask_secret(&self, _kind: &str, _prompt: String) -> BoxFuture<Option<String>> {
            Box::pin(async { Some("pw".to_string()) })
        }
        fn confirm_host_key(&self, _info: HostKeyPrompt) -> BoxFuture<bool> {
            Box::pin(async { true })
        }
    }

    struct ServerState {
        sizes: Vec<(u32, u32)>,
        direct_tcpip_target: (String, u16),
        // Only the shell channel echoes; direct-tcpip channels are bridged.
        shell_channel: Option<russh::ChannelId>,
    }

    /// Minimal in-process SSH server: password auth (u/pw), echo shell on
    /// session channels, and direct-tcpip bridged to a fixed target.
    #[derive(Clone)]
    struct TestServer {
        state: Arc<Mutex<ServerState>>,
    }

    impl server::Handler for TestServer {
        type Error = russh::Error;

        async fn auth_password(&mut self, user: &str, password: &str) -> Result<Auth, Self::Error> {
            Ok(if user == "u" && password == "pw" {
                Auth::Accept
            } else {
                Auth::reject()
            })
        }

        async fn channel_open_session(
            &mut self,
            channel: russh::Channel<ServerMsg>,
            reply: server::ChannelOpenHandle,
            _session: &mut server::Session,
        ) -> Result<(), Self::Error> {
            reply.accept().await;
            // Keep the channel alive by spawning a reader that just drains
            // window adjustments etc.; echo itself happens in data().
            let (mut rd, _wr) = channel.split();
            tauri::async_runtime::spawn(async move { while rd.wait().await.is_some() {} });
            Ok(())
        }

        async fn channel_open_direct_tcpip(
            &mut self,
            channel: russh::Channel<ServerMsg>,
            _host: &str,
            port: u32,
            _orig_addr: &str,
            _orig_port: u32,
            reply: server::ChannelOpenHandle,
            _session: &mut server::Session,
        ) -> Result<(), Self::Error> {
            reply.accept().await;
            let (host, _) = self.state.lock().unwrap().direct_tcpip_target.clone();
            tauri::async_runtime::spawn(async move {
                if let Ok(stream) = tokio::net::TcpStream::connect((host.as_str(), port as u16)).await {
                    bridge_tcp_channel(stream, channel).await;
                }
            });
            Ok(())
        }

        async fn pty_request(
            &mut self,
            channel: russh::ChannelId,
            _term: &str,
            _cols: u32,
            _rows: u32,
            _pw: u32,
            _ph: u32,
            _modes: &[(russh::Pty, u32)],
            session: &mut server::Session,
        ) -> Result<(), Self::Error> {
            session.channel_success(channel)?;
            Ok(())
        }

        async fn shell_request(
            &mut self,
            channel: russh::ChannelId,
            session: &mut server::Session,
        ) -> Result<(), Self::Error> {
            self.state.lock().unwrap().shell_channel = Some(channel);
            session.channel_success(channel)?;
            session.data(channel, b"shell-ready\r\n".to_vec())?;
            Ok(())
        }

        async fn data(
            &mut self,
            channel: russh::ChannelId,
            data: &[u8],
            session: &mut server::Session,
        ) -> Result<(), Self::Error> {
            if self.state.lock().unwrap().shell_channel != Some(channel) {
                return Ok(()); // forwarding channel — the bridge handles it
            }
            let mut reply = b"echo:".to_vec();
            reply.extend_from_slice(data);
            session.data(channel, reply)?;
            Ok(())
        }

        async fn window_change_request(
            &mut self,
            _channel: russh::ChannelId,
            cols: u32,
            rows: u32,
            _pw: u32,
            _ph: u32,
            _session: &mut server::Session,
        ) -> Result<(), Self::Error> {
            self.state.lock().unwrap().sizes.push((cols, rows));
            Ok(())
        }
    }

    /// Plain TCP echo server — the forwarding target.
    async fn spawn_tcp_echo() -> u16 {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tauri::async_runtime::spawn(async move {
            loop {
                let Ok((mut s, _)) = listener.accept().await else { break };
                tauri::async_runtime::spawn(async move {
                    let (mut r, mut w) = s.split();
                    let _ = tokio::io::copy(&mut r, &mut w).await;
                });
            }
        });
        port
    }

    fn test_session(port: u16) -> SshSession {
        SshSession {
            cancel: Arc::new(AtomicBool::new(false)),
            close_notify: Arc::new(tokio::sync::Notify::new()),
            live: Arc::new(tokio::sync::Mutex::new(None)),
            size: Arc::new(Mutex::new((80, 24))),
            spec: EmbeddedSshSpec {
                hostname: "127.0.0.1".into(),
                port,
                user: "u".into(),
                identity_file: Some("definitely/does/not/exist".into()),
            },
            cached_password: Arc::new(Mutex::new(None)),
            forwards: Arc::new(Mutex::new(HashMap::new())),
            next_forward: Arc::new(AtomicU64::new(1)),
        }
    }

    fn temp_known_hosts(tag: &str) -> PathBuf {
        std::env::temp_dir().join(format!("tterm-test-known-hosts-{}-{}", std::process::id(), tag))
    }

    /// Full round trip against the in-process server: password auth, shell
    /// echo, window_change, and a dynamically added local (-L) forward.
    #[test]
    fn embedded_ssh_end_to_end() {
        tauri::async_runtime::block_on(async {
            let echo_port = spawn_tcp_echo().await;
            let server_state = Arc::new(Mutex::new(ServerState {
                sizes: Vec::new(),
                direct_tcpip_target: ("127.0.0.1".into(), echo_port),
                shell_channel: None,
            }));

            // Bind the SSH server.
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let ssh_port = listener.local_addr().unwrap().port();
            {
                let state = server_state.clone();
                tauri::async_runtime::spawn(async move {
                    loop {
                        let Ok((stream, _)) = listener.accept().await else { break };
                        let key = russh::keys::PrivateKey::from_openssh(TEST_HOST_KEY).unwrap();
                        let config = Arc::new(server::Config {
                            keys: vec![key],
                            auth_rejection_time: Duration::ZERO,
                            ..Default::default()
                        });
                        let handler = TestServer { state: state.clone() };
                        tauri::async_runtime::spawn(async move {
                            let _ = server::run_stream(config, stream, handler).await;
                        });
                    }
                });
            }

            // Connect: password auth via the auto-prompter, fresh known_hosts.
            let kh = temp_known_hosts("e2e");
            let _ = std::fs::remove_file(&kh);
            let session = test_session(ssh_port);
            let (reader, mut writer) = connect_session_with(&session, Arc::new(TestPrompter), Some(kh.clone()))
                .await
                .expect("connect + auth + shell");

            // Host key should have been learned (TOFU accepted by prompter).
            let learned = std::fs::read_to_string(&kh).expect("known_hosts written");
            assert!(learned.contains("[127.0.0.1]:"), "host learned: {learned}");

            // One collector thread (like the relay pump) reads everything:
            // the shell banner first, then our echo.
            let collector = std::thread::spawn(move || {
                let mut r = reader;
                let mut collected = Vec::new();
                let mut buf = [0u8; 256];
                while !collected.ends_with(b"echo:ping") {
                    let n = r.read(&mut buf).expect("read");
                    assert!(n > 0, "unexpected EOF before echo");
                    collected.extend_from_slice(&buf[..n]);
                }
                collected
            });
            writer.write_all(b"ping").unwrap();
            writer.flush().unwrap();
            let collected = collector.join().unwrap();
            let text = String::from_utf8_lossy(&collected);
            assert!(text.contains("shell-ready"), "banner: {text}");
            assert!(text.contains("echo:ping"), "echo: {text}");

            // Resize propagates as window_change to the server.
            resize_ssh_session(&session, 132, 43);
            for _ in 0..50 {
                if server_state.lock().unwrap().sizes.contains(&(132, 43)) {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
            assert!(
                server_state.lock().unwrap().sizes.contains(&(132, 43)),
                "server saw window_change"
            );

            // Dynamic local forward: add at runtime, then push bytes through.
            let fwd_id = add_forward(&session, "local", "127.0.0.1".into(), 0, "127.0.0.1".into(), echo_port)
                .await
                .expect("add forward");
            let listen_port = {
                let t = session.forwards.lock().unwrap();
                // port 0 means the OS picked one — read it back from the entry
                t.get(&fwd_id).map(|e| e.info.listen_port)
            };
            // listen_port 0 was requested; discover the bound port by probing
            // the stored info (spawn_local_forward binds the requested port,
            // so use a fixed free port instead for determinism).
            let listen_port = match listen_port {
                Some(0) | None => {
                    // re-add with an explicit free port
                    let probe = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
                    let free = probe.local_addr().unwrap().port();
                    drop(probe);
                    add_forward(&session, "local", "127.0.0.1".into(), free, "127.0.0.1".into(), echo_port)
                        .await
                        .expect("add forward fixed port");
                    free
                }
                Some(p) => p,
            };
            tokio::time::sleep(Duration::from_millis(200)).await;
            let mut proxied = tokio::net::TcpStream::connect(("127.0.0.1", listen_port)).await.unwrap();
            tokio::io::AsyncWriteExt::write_all(&mut proxied, b"tunnel").await.unwrap();
            let mut got = vec![0u8; 6];
            tokio::time::timeout(
                Duration::from_secs(5),
                tokio::io::AsyncReadExt::read_exact(&mut proxied, &mut got),
            )
            .await
            .expect("tunnel reply in time")
            .expect("tunnel reply");
            assert_eq!(&got, b"tunnel", "bytes round-tripped through the SSH tunnel");

            kill_ssh_session(&session);
        });
    }
}
