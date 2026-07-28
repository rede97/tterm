//! Unified WebSocket relay hub.
//!
//! A single loopback WS server (bound once at startup on a random port)
//! multiplexes every session. Routing is by URL path:
//!
//!   ws://127.0.0.1:<port>/pty/<session-id>?token=<token>
//!
//! Security: unlike the old per-session random ports (where the port itself
//! was the unguessable capability), this port is fixed for the process
//! lifetime, so every handshake must carry the per-process random token.
//! Without it any local process could attach to — and type into — a shell.

use futures_util::{SinkExt, StreamExt};
use http::StatusCode;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tokio::sync::mpsc;
use tokio_tungstenite::accept_hdr_async;
use tokio_tungstenite::tungstenite::handshake::server::{ErrorResponse, Request, Response};
use tokio_tungstenite::tungstenite::Message as WsMessage;

// One relay slot per session id.
struct RelayEntry {
    // Downstream direction (session → client). `rx` is Some until a WS
    // client claims it during the handshake; a disconnecting client returns
    // it so a later client can RE-ATTACH (transport drops — e.g. OS sleep —
    // must not kill a live session). While detached, session output simply
    // buffers in the channel and is flushed to the next client.
    // Never read — held so the channel stays open while the session lives;
    // dropping the entry (kill / EOF cleanup / reconnect replace) is what
    // lets the connected client's Close frame fire.
    #[allow(dead_code)]
    tx: mpsc::Sender<Vec<u8>>,
    rx: Option<mpsc::Receiver<Vec<u8>>>,
    // Upstream direction (client → session). The boxed writer is HOT-SWAPPED:
    // while the session is dead it is a DeadWatcher (Enter → respawn), and a
    // successful respawn installs the new child writer.
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    // Guards the EOF cleanup against a reconnect that reused the same id.
    generation: u64,
    // Set by the currently attached connection. A new handshake that finds
    // `rx` taken fires it: the old client is necessarily dead (a live one
    // would never re-handshake — half-open TCP after e.g. sleep/wake), and
    // the kick makes it release `rx` promptly instead of waiting for a TCP
    // timeout.
    kick: Option<tokio::sync::oneshot::Sender<()>>,
    // Fired by unregister_session (tab kill): wakes the read pump out of its
    // blocking read / dead-mode park so the channel can close.
    cancel: Arc<AtomicBool>,
}

pub struct WsHub {
    pub(crate) port: u16,
    pub(crate) token: String,
    entries: Mutex<HashMap<String, RelayEntry>>,
    next_generation: AtomicU64,
}

impl WsHub {
    // Bind the loopback listener, generate the auth token, spawn the accept
    // loop. Called exactly once at app startup.
    pub(crate) fn start() -> Result<Arc<WsHub>, String> {
        let listener = std::net::TcpListener::bind("127.0.0.1:0")
            .map_err(|e| format!("Failed to bind local WS hub: {}", e))?;
        listener
            .set_nonblocking(true)
            .map_err(|e| format!("set_nonblocking: {}", e))?;
        let port = listener
            .local_addr()
            .map_err(|e| format!("Failed to get port: {}", e))?
            .port();

        let hub = Arc::new(WsHub {
            port,
            token: generate_token(),
            entries: Mutex::new(HashMap::new()),
            next_generation: AtomicU64::new(1),
        });

        let rt = tauri::async_runtime::handle();
        let hub2 = hub.clone();
        rt.spawn(async move {
            let tl = match tokio::net::TcpListener::from_std(listener) {
                Ok(tl) => tl,
                Err(_) => return,
            };
            loop {
                match tl.accept().await {
                    Ok((stream, _)) => {
                        let hub = hub2.clone();
                        tauri::async_runtime::spawn(handle_connection(hub, stream));
                    }
                    Err(_) => continue,
                }
            }
        });

        Ok(hub)
    }
}

// Per-process random auth token (64 hex chars from the OS CSPRNG).
fn generate_token() -> String {
    use rand::RngCore;
    let mut bytes = [0u8; 32];
    rand::rng().fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

// Extract the session id from "/pty/<id>".
fn parse_route(path: &str) -> Option<String> {
    let id = path.strip_prefix("/pty/")?;
    if id.is_empty() || id.contains('/') {
        return None;
    }
    Some(id.to_string())
}

// Extract a single query parameter value ("a=1&b=2" form, no percent-decoding
// — the token is plain hex and needs none).
fn query_param<'a>(query: Option<&'a str>, key: &str) -> Option<&'a str> {
    let query = query?;
    let prefix = format!("{}=", key);
    for pair in query.split('&') {
        if let Some(v) = pair.strip_prefix(prefix.as_str()) {
            if !v.is_empty() {
                return Some(v);
            }
        }
    }
    None
}

fn reject(status: StatusCode, msg: &str) -> ErrorResponse {
    let mut resp = http::Response::new(Some(msg.to_string()));
    *resp.status_mut() = status;
    resp
}

// Handle one TCP connection: route + authenticate during the WS handshake,
// then pump bytes in both directions until either side ends.
// result_large_err: the ErrorResponse variant is imposed by
// accept_hdr_async's callback signature; cannot box it here.
#[allow(clippy::result_large_err)]
async fn handle_connection(hub: Arc<WsHub>, stream: tokio::net::TcpStream) {
    // Claimed during the handshake callback: (id, downstream rx, writer, generation).
    type Claimed = (String, mpsc::Receiver<Vec<u8>>, Arc<Mutex<Box<dyn Write + Send>>>, u64);
    let mut claimed: Option<Claimed> = None;
    // Fired by a LATER handshake that finds this connection still holding the
    // downstream receiver (stale half-open): tells our sender task to release it.
    let (kick_tx, kick_rx) = tokio::sync::oneshot::channel::<()>();

    let cb = |req: &Request, resp: Response| -> Result<Response, ErrorResponse> {
        let id = parse_route(req.uri().path())
            .ok_or_else(|| reject(StatusCode::NOT_FOUND, "unknown route"))?;
        let token = query_param(req.uri().query(), "token")
            .ok_or_else(|| reject(StatusCode::FORBIDDEN, "missing token"))?;
        if token != hub.token {
            return Err(reject(StatusCode::FORBIDDEN, "invalid token"));
        }
        let mut entries = hub
            .entries
            .lock()
            .map_err(|_| reject(StatusCode::INTERNAL_SERVER_ERROR, "hub lock poisoned"))?;
        let entry = entries
            .get_mut(&id)
            .ok_or_else(|| reject(StatusCode::NOT_FOUND, "no such session"))?;
        let rx = match entry.rx.take() {
            Some(rx) => rx,
            None => {
                // A previous connection never released the slot (half-open
                // TCP: client gone, server not yet notified). Kick it so the
                // client's retry — the frontend backs off and retries — finds
                // the receiver returned.
                if let Some(kick) = entry.kick.take() {
                    let _ = kick.send(());
                }
                return Err(reject(StatusCode::CONFLICT, "session already attached"));
            }
        };
        entry.kick = Some(kick_tx);
        claimed = Some((id, rx, entry.writer.clone(), entry.generation));
        Ok(resp)
    };

    let ws = match accept_hdr_async(stream, cb).await {
        Ok(ws) => ws,
        Err(_) => {
            // Handshake failed AFTER we claimed the slot (client vanished
            // mid-handshake): put the receiver back so a retry can attach.
            if let Some((id, rx, _, generation)) = claimed.take() {
                if let Ok(mut entries) = hub.entries.lock() {
                    if let Some(entry) = entries.get_mut(&id) {
                        if entry.generation == generation && entry.rx.is_none() {
                            entry.rx = Some(rx);
                            entry.kick = None;
                        }
                    }
                }
            }
            return;
        }
    };
    let Some((id, mut rx, writer, generation)) = claimed.take() else { return };

    let (mut ws_sink, mut ws_stream) = ws.split();

    // Lets the read half (below) stop the sender task when the client goes
    // away, so the receiver is returned without waiting for new session output.
    let (stop_tx, mut stop_rx) = tokio::sync::oneshot::channel::<()>();

    // Task A: channel → WS sink. When the channel closes (session EOF or
    // kill), send a proper Close frame — merely dropping the sink half would
    // leave the TCP connection open silently, and the frontend relies on the
    // 'close' event to mark the session disconnected. When the CLIENT goes
    // away instead (stop/kick), return the receiver to the entry so the
    // session survives and a new client can re-attach with buffered output.
    let hub_a = hub.clone();
    tauri::async_runtime::spawn(async move {
        // Option so the branch can be disabled: when the ENTRY is dropped
        // (session EOF cleanup / kill / reconnect-replace), our kick sender
        // drops with it and the receiver resolves Err — that is NOT a kick,
        // the channel close must still be drained so the client gets its
        // Close frame.
        let mut kick_rx = Some(kick_rx);
        loop {
            tokio::select! {
                _ = &mut stop_rx => break,
                res = async { kick_rx.as_mut().unwrap().await }, if kick_rx.is_some() => {
                    if res.is_ok() {
                        break; // genuinely kicked by a newer handshake
                    }
                    kick_rx = None; // sender dropped with the entry: not a kick
                }
                data = rx.recv() => {
                    match data {
                        Some(d) => {
                            if ws_sink.send(WsMessage::Binary(d)).await.is_err() {
                                break;
                            }
                        }
                        None => {
                            let _ = ws_sink.close().await;
                            break;
                        }
                    }
                }
            }
        }
        // Hand the downstream receiver back: a new client may claim it. No-op
        // when the entry is gone (session EOF/kill) or was replaced by a
        // reconnect that reused the same id (generation mismatch).
        if let Ok(mut entries) = hub_a.entries.lock() {
            if let Some(entry) = entries.get_mut(&id) {
                if entry.generation == generation && entry.rx.is_none() {
                    entry.rx = Some(rx);
                    entry.kick = None;
                }
            }
        }
    });

    // Task B: WS stream → session writer (keystrokes).
    while let Some(Ok(msg)) = ws_stream.next().await {
        let data = match msg {
            WsMessage::Binary(d) => d,
            WsMessage::Text(t) => t.into_bytes(),
            WsMessage::Close(_) => break,
            _ => continue,
        };
        let w = writer.clone();
        let result = tokio::task::spawn_blocking(move || {
            let mut guard = match w.lock() {
                Ok(g) => g,
                Err(_) => return,
            };
            if guard.write_all(&data).is_err() {
                return;
            }
            let _ = guard.flush();
        })
        .await;
        if result.is_err() {
            break;
        }
    }
    // Client connection ended: stop the sender task so it returns the
    // receiver for a future re-attach.
    let _ = stop_tx.send(());
}

// Reconnect hooks: when a session's byte stream ends (shell exit, SSH drop,
// serial unplug), the relay can keep the WebSocket alive instead of closing
// it — it injects a reset+notice downstream, swallows upstream input except
// Enter, and respawns the session in place on Enter. The disconnect thus
// appears IN the terminal stream (preserved in scrollback, with a timestamp),
// and Enter works through the normal xterm data path with no frontend focus
// handling.
pub(crate) struct ReconnectHooks {
    // Terminal reset + disconnect notice injected downstream on stream EOF.
    pub(crate) notice: Box<dyn Fn() -> Vec<u8> + Send + Sync>,
    // Respawn the session; returns the new (reader, writer). Called from a
    // blocking thread (the relay write path); may take hundreds of ms.
    pub(crate) respawn: Box<dyn Fn() -> RespawnOutcome + Send + Sync>,
    // Bytes injected downstream right after a successful respawn, BEFORE the
    // new stream's output. PTY sessions scroll the dead viewport up into
    // scrollback here (a fresh ConPTY opens with `\x1b[2J` — erase visible
    // display — so without this the on-screen content would be lost).
    pub(crate) pre_resume: Box<dyn Fn() -> Vec<u8> + Send + Sync>,
    // State signal for the tab UI: false when the stream dies, true after a
    // successful respawn.
    pub(crate) on_state: Box<dyn Fn(bool) + Send + Sync>,
}

// The two ends of a session byte stream (reader from child, writer to child).
pub(crate) type SessionIo = (Box<dyn Read + Send>, Box<dyn Write + Send>);

type RespawnOutcome = Result<SessionIo, String>;

// Upstream writer installed while a session is dead: swallows all input
// except Enter, which runs the respawn (blocking) and hands the outcome to
// the parked read pump. Single-fire: after the first Enter, later keystrokes
// are ignored until the pump installs a fresh watcher (failure) or the new
// child writer (success).
struct DeadWatcher {
    hooks: Arc<ReconnectHooks>,
    result_tx: Option<std::sync::mpsc::Sender<RespawnOutcome>>,
}

impl Write for DeadWatcher {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        if crate::deadmode::contains_enter(buf) {
            if let Some(tx) = self.result_tx.take() {
                let _ = tx.send((self.hooks.respawn)());
            }
        }
        Ok(buf.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

// Register a session's byte stream with the hub under `id`. The blocking read
// pump starts immediately; the first WS client that connects to
// /pty/<id>?token=... claims the downstream channel.
//
// With `hooks`, stream EOF does NOT end the relay slot: the pump enters dead
// mode (notice + Enter-to-respawn) and only a kill (unregister_session)
// tears the slot down. Without hooks, EOF closes the channel and the client
// gets a Close frame as before.
pub(crate) fn register_session<R, W>(
    hub: &Arc<WsHub>,
    id: &str,
    reader: R,
    writer: W,
    hooks: Option<ReconnectHooks>,
) -> Result<(), String>
where
    R: Read + Send + 'static,
    W: Write + Send + 'static,
{
    let (tx, rx) = mpsc::channel::<Vec<u8>>(256);
    let generation = hub.next_generation.fetch_add(1, Ordering::Relaxed);
    // Two senders exist: the entry's and the read pump's. The channel closes
    // only when BOTH are gone — i.e. the pump exited (kill/cancel) AND the
    // entry was removed (teardown below or kill).
    let cancel = Arc::new(AtomicBool::new(false));
    let writer = Arc::new(Mutex::new(Box::new(writer) as Box<dyn Write + Send>));
    let entry = RelayEntry {
        tx: tx.clone(),
        rx: Some(rx),
        writer: writer.clone(),
        generation,
        kick: None,
        cancel: cancel.clone(),
    };
    hub.entries
        .lock()
        .map_err(|e| e.to_string())?
        .insert(id.to_string(), entry);

    let hooks = hooks.map(Arc::new);
    let rt = tauri::async_runtime::handle();
    let hub2 = hub.clone();
    let id2 = id.to_string();
    rt.spawn(async move {
        let _ = tokio::task::spawn_blocking(move || {
            read_pump(Box::new(reader), writer, cancel, hooks, tx);
        })
        .await;
        // Final teardown (kill / cancel): remove OUR entry so the channel
        // closes and the client gets its Close frame. The generation check
        // avoids removing a newer entry that reused the same id.
        if let Ok(mut entries) = hub2.entries.lock() {
            if entries.get(&id2).is_some_and(|e| e.generation == generation) {
                entries.remove(&id2);
            }
        }
    });

    Ok(())
}

// The session read pump. Live mode forwards stream bytes to the WS channel.
// On stream EOF with reconnect hooks it parks in dead mode: notice downstream,
// Enter-watcher upstream, respawn-and-resume on Enter. Returns only on final
// teardown (kill / cancel / channel gone).
fn read_pump(
    mut reader: Box<dyn Read + Send>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    cancel: Arc<AtomicBool>,
    hooks: Option<Arc<ReconnectHooks>>,
    tx: mpsc::Sender<Vec<u8>>,
) {
    let mut buf = [0u8; 16384];
    'live: loop {
        // ---- live forwarding ----
        loop {
            if cancel.load(Ordering::Relaxed) {
                return;
            }
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    if tx.blocking_send(buf[..n].to_vec()).is_err() {
                        return;
                    }
                }
                Err(e) => {
                    // Serial reads use a timeout to poll `cancel`
                    if e.kind() == std::io::ErrorKind::TimedOut {
                        continue;
                    }
                    break;
                }
            }
        }
        if cancel.load(Ordering::Relaxed) {
            return;
        }
        let Some(hooks) = &hooks else { return };

        // ---- dead mode ----
        (hooks.on_state)(false);
        let _ = tx.blocking_send((hooks.notice)());
        'dead: loop {
            let (result_tx, result_rx) = std::sync::mpsc::channel::<RespawnOutcome>();
            {
                let watcher = DeadWatcher { hooks: hooks.clone(), result_tx: Some(result_tx) };
                match writer.lock() {
                    Ok(mut guard) => {
                        *guard = Box::new(watcher);
                    }
                    Err(_) => return,
                }
            }
            // Park until the watcher delivers a respawn outcome. Polls cancel
            // so a tab kill while dead unwinds promptly; Disconnected means
            // the watcher was dropped (entry removed = kill).
            let outcome = loop {
                if cancel.load(Ordering::Relaxed) {
                    return;
                }
                match result_rx.recv_timeout(std::time::Duration::from_millis(200)) {
                    Ok(o) => break o,
                    Err(std::sync::mpsc::RecvTimeoutError::Timeout) => continue,
                    Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => return,
                }
            };
            match outcome {
                Ok((new_reader, new_writer)) => {
                    match writer.lock() {
                        Ok(mut guard) => {
                            *guard = new_writer;
                        }
                        Err(_) => return,
                    }
                    reader = new_reader;
                    (hooks.on_state)(true);
                    // Pre-resume injection (e.g. scroll the dead viewport
                    // into scrollback before a fresh ConPTY's `\x1b[2J`).
                    let _ = tx.blocking_send((hooks.pre_resume)());
                    continue 'live;
                }
                Err(msg) => {
                    // Stay dead; the user can press Enter to try again.
                    let _ = tx.blocking_send(crate::deadmode::respawn_failed(&msg));
                    continue 'dead;
                }
            }
        }
    }
}

// Drop a session's relay slot (tab kill). Cancels the read pump (waking it
// from a blocking read timeout / dead-mode park) and drops the entry; the
// channel closes once the pump exits, and the underlying stream dies with it
// (or its own cancel, e.g. serial, fires in kill_session_resources).
pub(crate) fn unregister_session(hub: &Arc<WsHub>, id: &str) {
    if let Ok(mut entries) = hub.entries.lock() {
        if let Some(entry) = entries.remove(id) {
            entry.cancel.store(true, Ordering::Relaxed);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn route_extracts_session_id() {
        assert_eq!(parse_route("/pty/tab-1"), Some("tab-1".to_string()));
        assert_eq!(parse_route("/pty/tab-42"), Some("tab-42".to_string()));
    }

    #[test]
    fn route_rejects_other_paths() {
        assert_eq!(parse_route("/"), None);
        assert_eq!(parse_route("/pty/"), None);
        assert_eq!(parse_route("/pty/a/b"), None);
        assert_eq!(parse_route("/other/tab-1"), None);
        assert_eq!(parse_route("/pty"), None);
    }

    #[test]
    fn query_param_extracts_token() {
        assert_eq!(query_param(Some("token=abc123"), "token"), Some("abc123"));
        assert_eq!(query_param(Some("x=1&token=deadbeef&y=2"), "token"), Some("deadbeef"));
    }

    #[test]
    fn query_param_rejects_missing_or_empty() {
        assert_eq!(query_param(None, "token"), None);
        assert_eq!(query_param(Some(""), "token"), None);
        assert_eq!(query_param(Some("token="), "token"), None);
        assert_eq!(query_param(Some("tokenx=abc"), "token"), None);
        assert_eq!(query_param(Some("other=abc"), "token"), None);
    }

    // Full relay path against a real hub: loopback TCP pair stands in for the
    // PTY (echo thread = "shell"), sync tungstenite client = the frontend.
    #[test]
    fn hub_routing_auth_echo_and_eof_close() {
        use std::time::Duration;
        use tokio_tungstenite::tungstenite;

        let hub = WsHub::start().expect("hub start");
        std::thread::sleep(Duration::from_millis(150)); // accept loop up

        // Session byte stream: loopback TCP pair.
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let session_side = std::net::TcpStream::connect(listener.local_addr().unwrap()).unwrap();
        let (mut echo_side, _) = listener.accept().unwrap();
        let session_reader = session_side.try_clone().unwrap();

        // The "shell": bounce everything back; exits on the magic "quit"
        // frame (dropping its end EOFs the relay's read loop, like a real
        // shell exit does through the ConPTY watchdog).
        let echo_handle = std::thread::spawn(move || {
            let mut buf = [0u8; 1024];
            loop {
                match echo_side.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        if &buf[..n] == b"quit" {
                            break;
                        }
                        if echo_side.write_all(&buf[..n]).is_err() {
                            break;
                        }
                    }
                }
            }
        });

        register_session(&hub, "tab-t", session_reader, session_side, None).unwrap();

        #[allow(clippy::result_large_err)] // tungstenite::client err size
        let connect_ws = |path: &str| {
            let stream = std::net::TcpStream::connect(format!("127.0.0.1:{}", hub.port)).unwrap();
            tungstenite::client(format!("ws://127.0.0.1:{}{}", hub.port, path), stream)
        };

        // Wrong token → handshake rejected.
        assert!(connect_ws("/pty/tab-t?token=wrong").is_err());
        // Missing token → rejected.
        assert!(connect_ws("/pty/tab-t").is_err());
        // Unknown session id → rejected.
        assert!(connect_ws(&format!("/pty/nope?token={}", hub.token)).is_err());
        // Unknown route → rejected.
        assert!(connect_ws(&format!("/other/tab-t?token={}", hub.token)).is_err());

        // Correct route + token: echo roundtrip through the relay.
        let (mut ws, _resp) = connect_ws(&format!("/pty/tab-t?token={}", hub.token)).expect("handshake");
        ws.get_mut().set_read_timeout(Some(Duration::from_secs(5))).unwrap();
        ws.send(tungstenite::Message::Binary(b"ping".to_vec())).unwrap();
        let msg = ws.read().expect("echo reply");
        assert_eq!(msg.into_data(), b"ping".to_vec());

        // Shell exit: the echo thread drops its end -> read loop EOF ->
        // entry cleanup -> channel closes -> client receives a Close frame
        // (the frontend's disconnect signal).
        ws.send(tungstenite::Message::Binary(b"quit".to_vec())).unwrap();
        let close = ws.read().expect("close frame");
        assert!(close.is_close(), "expected Close, got {:?}", close);

        // Kill path: unregistering must not panic and must be idempotent.
        unregister_session(&hub, "tab-t");
        unregister_session(&hub, "tab-t");

        // After a clean EOF close the session is gone: re-attach is rejected.
        assert!(connect_ws(&format!("/pty/tab-t?token={}", hub.token)).is_err());

        echo_handle.join().unwrap();
    }

    // Abnormal client drop (OS sleep/wake resetting loopback TCP, WebView2
    // discarding the socket): the session must SURVIVE — a new client can
    // re-attach to the same id and keep talking to the same backend stream.
    #[test]
    fn hub_reattach_after_client_drop() {
        use std::time::Duration;
        use tokio_tungstenite::tungstenite;

        let hub = WsHub::start().expect("hub start");
        std::thread::sleep(Duration::from_millis(150));

        // Session byte stream: loopback TCP pair; the test plays the "shell".
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let session_side = std::net::TcpStream::connect(listener.local_addr().unwrap()).unwrap();
        let (mut shell_side, _) = listener.accept().unwrap();
        shell_side.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
        let session_reader = session_side.try_clone().unwrap();

        register_session(&hub, "tab-r", session_reader, session_side, None).unwrap();

        let connect = || {
            let stream = std::net::TcpStream::connect(format!("127.0.0.1:{}", hub.port)).unwrap();
            let (mut ws, _r) = tungstenite::client(
                format!("ws://127.0.0.1:{}/pty/tab-r?token={}", hub.port, hub.token),
                stream,
            ).expect("handshake");
            ws.get_mut().set_read_timeout(Some(Duration::from_secs(5))).unwrap();
            ws
        };

        // Client 1: sanity roundtrip, then an abnormal drop (no Close
        // handshake — dropping the socket mid-stream, like an OS sleep).
        let mut ws1 = connect();
        ws1.send(tungstenite::Message::Binary(b"a".to_vec())).unwrap();
        let mut buf = [0u8; 16];
        let n = shell_side.read(&mut buf).unwrap();
        assert_eq!(&buf[..n], b"a");
        drop(ws1);

        // Give the relay a moment to notice the FIN and return the receiver.
        std::thread::sleep(Duration::from_millis(300));

        // Output produced while detached is buffered, not lost.
        shell_side.write_all(b"while-away").unwrap();

        // Client 2 re-attaches to the SAME session: buffered output arrives…
        let mut ws2 = connect();
        let msg = ws2.read().expect("buffered output");
        assert_eq!(msg.into_data(), b"while-away".to_vec());

        // …and the upstream direction works again (keystrokes reach the shell).
        ws2.send(tungstenite::Message::Binary(b"b".to_vec())).unwrap();
        let n = shell_side.read(&mut buf).unwrap();
        assert_eq!(&buf[..n], b"b");
    }

    // A second handshake while a client is attached is rejected (409) — but
    // it also KICKS the stale holder, because a live client would never
    // re-handshake: the old connection must be half-open (client gone, TCP
    // not yet torn down server-side). The retry then attaches cleanly.
    #[test]
    fn hub_kick_releases_stale_slot() {
        use std::time::Duration;
        use tokio_tungstenite::tungstenite;

        let hub = WsHub::start().expect("hub start");
        std::thread::sleep(Duration::from_millis(150));

        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let session_side = std::net::TcpStream::connect(listener.local_addr().unwrap()).unwrap();
        let (_shell_side, _) = listener.accept().unwrap();
        let session_reader = session_side.try_clone().unwrap();

        register_session(&hub, "tab-k", session_reader, session_side, None).unwrap();

        let url = format!("ws://127.0.0.1:{}/pty/tab-k?token={}", hub.port, hub.token);
        #[allow(clippy::result_large_err)] // tungstenite::client err size
        let connect = |url: &str| {
            let stream = std::net::TcpStream::connect(format!("127.0.0.1:{}", hub.port)).unwrap();
            tungstenite::client(url, stream)
        };

        let (mut ws1, _r) = connect(&url).expect("first attach");
        ws1.get_mut().set_read_timeout(Some(Duration::from_secs(5))).unwrap();

        // Second concurrent attach: rejected, and the stale holder is kicked.
        assert!(connect(&url).is_err());

        // The kicked connection dies without a clean Close (abnormal from the
        // client's perspective — its frontend will auto re-attach).
        std::thread::sleep(Duration::from_millis(100));
        let died = ws1.read().is_err();
        assert!(died, "kicked client should lose its connection");

        // The slot is released: a retry attaches.
        std::thread::sleep(Duration::from_millis(300));
        let (mut ws2, _r) = connect(&url).expect("reattach after kick");
        ws2.get_mut().set_read_timeout(Some(Duration::from_secs(5))).unwrap();
    }

    // After a client-initiated WS Close (tab teardown navigations etc.) the
    // session likewise survives for re-attach.
    #[test]
    fn hub_reattach_after_clean_client_close() {
        use std::time::Duration;
        use tokio_tungstenite::tungstenite;

        let hub = WsHub::start().expect("hub start");
        std::thread::sleep(Duration::from_millis(150));

        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let session_side = std::net::TcpStream::connect(listener.local_addr().unwrap()).unwrap();
        let (_shell_side, _) = listener.accept().unwrap();
        let session_reader = session_side.try_clone().unwrap();

        register_session(&hub, "tab-c", session_reader, session_side, None).unwrap();

        let url = format!("ws://127.0.0.1:{}/pty/tab-c?token={}", hub.port, hub.token);
        #[allow(clippy::result_large_err)] // tungstenite::client err size
        let connect = |url: &str| {
            let stream = std::net::TcpStream::connect(format!("127.0.0.1:{}", hub.port)).unwrap();
            tungstenite::client(url, stream)
        };

        let (mut ws1, _r) = connect(&url).expect("first attach");
        ws1.close(None).unwrap();
        drop(ws1);
        std::thread::sleep(Duration::from_millis(300));

        let (_ws2, _r) = connect(&url).expect("reattach after client close");
    }

    // Dead mode: with reconnect hooks, stream EOF does NOT close the socket.
    // The relay injects the notice, swallows non-Enter input, and respawns
    // in place on Enter — the client keeps using the same WebSocket.
    #[test]
    fn hub_dead_mode_notice_and_enter_respawn() {
        use std::sync::atomic::AtomicUsize;
        use std::time::Duration;
        use tokio_tungstenite::tungstenite;

        let hub = WsHub::start().expect("hub start");
        std::thread::sleep(Duration::from_millis(150));

        // "Shell" v1: echo server that exits on the magic "quit" frame.
        let mk_shell = || {
            let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            let session_side = std::net::TcpStream::connect(listener.local_addr().unwrap()).unwrap();
            let (mut echo_side, _) = listener.accept().unwrap();
            std::thread::spawn(move || {
                let mut buf = [0u8; 1024];
                loop {
                    match echo_side.read(&mut buf) {
                        Ok(0) | Err(_) => break,
                        Ok(n) => {
                            if &buf[..n] == b"quit" {
                                break;
                            }
                            if echo_side.write_all(&buf[..n]).is_err() {
                                break;
                            }
                        }
                    }
                }
            });
            session_side
        };

        let session_side = mk_shell();
        let session_reader = session_side.try_clone().unwrap();

        let respawns = Arc::new(AtomicUsize::new(0));
        let states = Arc::new(Mutex::new(Vec::<bool>::new()));
        let hooks = ReconnectHooks {
            notice: Box::new(|| b"\r\n[dead] press enter\r\n".to_vec()),
            pre_resume: Box::new(|| b"[scroll]".to_vec()),
            on_state: {
                let states = states.clone();
                Box::new(move |alive| states.lock().unwrap().push(alive))
            },
            respawn: {
                let respawns = respawns.clone();
                Box::new(move || {
                    respawns.fetch_add(1, Ordering::Relaxed);
                    let s = mk_shell();
                    let r = s.try_clone().unwrap();
                    Ok((Box::new(r) as Box<dyn Read + Send>, Box::new(s) as Box<dyn Write + Send>))
                })
            },
        };

        register_session(&hub, "tab-d", session_reader, session_side, Some(hooks)).unwrap();

        let stream = std::net::TcpStream::connect(format!("127.0.0.1:{}", hub.port)).unwrap();
        let (mut ws, _r) = tungstenite::client(
            format!("ws://127.0.0.1:{}/pty/tab-d?token={}", hub.port, hub.token),
            stream,
        ).expect("handshake");
        ws.get_mut().set_read_timeout(Some(Duration::from_secs(5))).unwrap();

        // Kill the shell: EOF -> dead mode -> the notice arrives in-band…
        ws.send(tungstenite::Message::Binary(b"quit".to_vec())).unwrap();
        let notice = ws.read().expect("dead-mode notice");
        assert_eq!(notice.into_data(), b"\r\n[dead] press enter\r\n".to_vec());
        // …and the socket stays OPEN (no Close frame).

        // Non-Enter input is swallowed: no respawn, nothing downstream.
        ws.send(tungstenite::Message::Binary(b"x".to_vec())).unwrap();
        std::thread::sleep(Duration::from_millis(300));
        assert_eq!(respawns.load(Ordering::Relaxed), 0);

        // Enter respawns in place; the same socket talks to the new shell.
        ws.send(tungstenite::Message::Binary(b"\r".to_vec())).unwrap();
        std::thread::sleep(Duration::from_millis(300));
        assert_eq!(respawns.load(Ordering::Relaxed), 1);
        // Pre-resume bytes arrive BEFORE the new stream's output.
        let scroll = ws.read().expect("pre-resume scroll");
        assert_eq!(scroll.into_data(), b"[scroll]".to_vec());
        ws.send(tungstenite::Message::Binary(b"ping".to_vec())).unwrap();
        let echo = ws.read().expect("echo from respawned shell");
        assert_eq!(echo.into_data(), b"ping".to_vec());

        // State transitions: died once, respawned once.
        assert_eq!(&*states.lock().unwrap(), &[false, true]);

        // Second death + failed respawn: failure line, still dead, retry works.
        ws.send(tungstenite::Message::Binary(b"quit".to_vec())).unwrap();
        let notice2 = ws.read().expect("second notice");
        assert_eq!(notice2.into_data(), b"\r\n[dead] press enter\r\n".to_vec());

        unregister_session(&hub, "tab-d");
    }

    // Killing a tab while its session is dead must not wedge the pump
    // (it parks in dead mode waiting for Enter that will never come).
    #[test]
    fn hub_kill_while_dead_shuts_down() {
        use std::time::Duration;
        use tokio_tungstenite::tungstenite;

        let hub = WsHub::start().expect("hub start");
        std::thread::sleep(Duration::from_millis(150));

        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let session_side = std::net::TcpStream::connect(listener.local_addr().unwrap()).unwrap();
        let (shell_side, _) = listener.accept().unwrap();
        let session_reader = session_side.try_clone().unwrap();

        let hooks = ReconnectHooks {
            notice: Box::new(|| b"dead\r\n".to_vec()),
            pre_resume: Box::new(Vec::new),
            on_state: Box::new(|_| {}),
            respawn: Box::new(|| Err("should not be called".into())),
        };
        register_session(&hub, "tab-x", session_reader, session_side, Some(hooks)).unwrap();

        let stream = std::net::TcpStream::connect(format!("127.0.0.1:{}", hub.port)).unwrap();
        let (mut ws, _r) = tungstenite::client(
            format!("ws://127.0.0.1:{}/pty/tab-x?token={}", hub.port, hub.token),
            stream,
        ).expect("handshake");
        ws.get_mut().set_read_timeout(Some(Duration::from_secs(5))).unwrap();

        // Shell dies -> dead mode (notice received).
        drop(shell_side);
        let notice = ws.read().expect("notice");
        assert_eq!(notice.into_data(), b"dead\r\n".to_vec());

        // Tab kill while dead: the pump must unwind and the client must get
        // a Close frame (not hang).
        unregister_session(&hub, "tab-x");
        let mut got_close = false;
        for _ in 0..20 {
            match ws.read() {
                Ok(m) if m.is_close() => {
                    got_close = true;
                    break;
                }
                Ok(_) => continue,
                Err(_) => break,
            }
        }
        assert!(got_close, "client should receive a Close frame after kill");
    }
}
