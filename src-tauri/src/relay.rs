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
    // client claims it during the handshake.
    // Never read — held so the channel stays open while the session lives;
    // dropping the entry (kill / EOF cleanup / reconnect replace) is what
    // lets the connected client's Close frame fire.
    #[allow(dead_code)]
    tx: mpsc::Sender<Vec<u8>>,
    rx: Option<mpsc::Receiver<Vec<u8>>>,
    // Upstream direction (client → session).
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    // Guards the EOF cleanup against a reconnect that reused the same id.
    generation: u64,
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
    rand::thread_rng().fill_bytes(&mut bytes);
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
async fn handle_connection(hub: Arc<WsHub>, stream: tokio::net::TcpStream) {
    // Claimed during the handshake callback: (id, downstream rx, writer).
    let mut claimed: Option<(String, mpsc::Receiver<Vec<u8>>, Arc<Mutex<Box<dyn Write + Send>>>)> = None;

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
        let rx = entry
            .rx
            .take()
            .ok_or_else(|| reject(StatusCode::CONFLICT, "session already attached"))?;
        claimed = Some((id, rx, entry.writer.clone()));
        Ok(resp)
    };

    let ws = match accept_hdr_async(stream, cb).await {
        Ok(ws) => ws,
        Err(_) => {
            // Handshake failed AFTER we claimed the slot (client vanished
            // mid-handshake): put the receiver back so a retry can attach.
            if let Some((id, rx, _)) = claimed.take() {
                if let Ok(mut entries) = hub.entries.lock() {
                    if let Some(entry) = entries.get_mut(&id) {
                        if entry.rx.is_none() {
                            entry.rx = Some(rx);
                        }
                    }
                }
            }
            return;
        }
    };
    let Some((_id, mut rx, writer)) = claimed.take() else { return };

    let (mut ws_sink, mut ws_stream) = ws.split();

    // Task A: channel → WS sink. When the channel closes (session EOF or
    // kill), send a proper Close frame — merely dropping the sink half would
    // leave the TCP connection open silently, and the frontend relies on the
    // 'close' event to mark the session disconnected.
    tauri::async_runtime::spawn(async move {
        while let Some(data) = rx.recv().await {
            if ws_sink.send(WsMessage::Binary(data)).await.is_err() {
                break;
            }
        }
        let _ = ws_sink.close().await;
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
}

// Register a session's byte stream with the hub under `id`. The blocking read
// loop starts immediately; the first WS client that connects to
// /pty/<id>?token=... claims the downstream channel.
//
// Re-registering an existing id (reconnect) replaces the stale entry: dropping
// its `tx` closes the old client's channel, so the old socket gets a Close
// frame and the frontend's disconnect handling fires as usual.
pub(crate) fn register_session<R, W>(
    hub: &Arc<WsHub>,
    id: &str,
    mut reader: R,
    writer: W,
    cancel: Option<Arc<AtomicBool>>,
) -> Result<(), String>
where
    R: Read + Send + 'static,
    W: Write + Send + 'static,
{
    let (tx, rx) = mpsc::channel::<Vec<u8>>(256);
    let generation = hub.next_generation.fetch_add(1, Ordering::Relaxed);
    // Two senders exist: the entry's and the read loop's. The channel closes
    // only when BOTH are gone — i.e. the loop exited (EOF/cancel) AND the
    // entry was removed (EOF cleanup below, kill, or reconnect replace).
    let entry = RelayEntry {
        tx: tx.clone(),
        rx: Some(rx),
        writer: Arc::new(Mutex::new(Box::new(writer))),
        generation,
    };
    hub.entries
        .lock()
        .map_err(|e| e.to_string())?
        .insert(id.to_string(), entry);

    let rt = tauri::async_runtime::handle();
    let hub2 = hub.clone();
    let id2 = id.to_string();
    rt.spawn(async move {
        let _ = tokio::task::spawn_blocking(move || {
            let mut buf = [0u8; 16384];
            loop {
                if let Some(c) = &cancel {
                    if c.load(Ordering::Relaxed) {
                        break;
                    }
                }
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        if tx.blocking_send(buf[..n].to_vec()).is_err() {
                            break;
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
        })
        .await;
        // Stream ended (shell exit / serial unplug): remove OUR entry so the
        // channel closes and the client gets its Close frame. The generation
        // check avoids removing a newer entry from a reconnect that reused
        // the same id while this read loop was still draining.
        if let Ok(mut entries) = hub2.entries.lock() {
            if entries.get(&id2).map_or(false, |e| e.generation == generation) {
                entries.remove(&id2);
            }
        }
    });

    Ok(())
}

// Drop a session's relay slot (tab closed / reconnect teardown). Dropping the
// entry closes the downstream channel; the read loop exits on its own once
// the underlying stream dies (or `cancel` fires for serial).
pub(crate) fn unregister_session(hub: &Arc<WsHub>, id: &str) {
    if let Ok(mut entries) = hub.entries.lock() {
        entries.remove(id);
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

        echo_handle.join().unwrap();
    }
}
