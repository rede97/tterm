//! Session lifecycle: shell-channel <-> relay bridge, TCP connect +
//! auth + shell setup, dead-mode reconnect hooks, and the spawn/resize/kill
//! entry points.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use russh::client::{self, Handle};
use russh::keys::PrivateKeyWithHashAlg;
use tauri::{Emitter, Manager};

use super::forward::reapply_forwards;
use super::hostkey::{known_hosts_path, SshHandler};
use super::prompter::{FrontendPrompter, Prompter};
use super::{EmbeddedSshSpec, SshLive, SshSession};
use crate::relay::{register_session, ReconnectHooks, SessionIo};
use crate::state::{AppState, SessionState, WsConnectResult};

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
pub(crate) async fn authenticate(
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
        if let Ok(r) = handle.authenticate_password(spec.user.clone(), pw).await {
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
pub(crate) async fn connect_session_with(
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
        client::connect(
            Arc::new(config),
            (spec.hostname.as_str(), spec.port),
            handler,
        ),
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
        let notify = session.close_notify.clone();
        let wh = shell_writer.clone();
        std::thread::spawn(move || loop {
            match in_rx.recv_timeout(Duration::from_millis(100)) {
                Ok(chunk) => {
                    // Race the send against close_notify: data_bytes can
                    // park for seconds while the channel window is full
                    // (slow server / flood), and kill must interrupt it
                    // instead of waiting for the idle-poll cancel check.
                    let sent = tauri::async_runtime::block_on(async {
                        let notified = notify.notified();
                        tokio::pin!(notified);
                        // Register the waiter BEFORE re-checking cancel, so a
                        // kill landing between the check and the select still
                        // wakes us (notify_waiters only reaches registered
                        // waiters).
                        notified.as_mut().enable();
                        if cancel.load(Ordering::Relaxed) {
                            return false;
                        }
                        tokio::select! {
                            r = wh.data_bytes(chunk) => r.is_ok(),
                            _ = notified => false,
                        }
                    });
                    if !sent {
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

    *session.live.lock().await = Some(SshLive {
        handle,
        shell_writer,
    });
    Ok((
        Box::new(SshReader {
            rx: out_rx,
            cur: std::collections::VecDeque::new(),
        }),
        Box::new(SshWriter { tx: in_tx }),
    ))
}

/// Re-apply every recorded forwarding after a (re)connect. Listener tasks
/// from a previous life are already dead (their handle was dropped).

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
                let _ = app.emit(
                    "session-state",
                    SessionState {
                        id: id.clone(),
                        alive,
                    },
                );
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
    register_session(
        &state.hub,
        &id,
        reader,
        writer,
        Some(ssh_hooks(app, id.clone(), auto)),
    )?;
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
            let _ = l
                .shell_writer
                .window_change(cols as u32, rows as u32, 0, 0)
                .await;
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
