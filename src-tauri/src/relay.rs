use futures_util::{SinkExt, StreamExt};
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tokio_tungstenite::accept_async;
use tokio_tungstenite::tungstenite::Message as WsMessage;

pub(crate) fn start_ws_relay<R, W>(mut reader: R, writer: W, cancel: Option<Arc<AtomicBool>>) -> Result<u16, String>
where
    R: Read + Send + 'static,
    W: Write + Send + 'static,
{
    // Bind WebSocket server on random port
    let listener = std::net::TcpListener::bind("127.0.0.1:0")
        .map_err(|e| format!("Failed to bind local WS: {}", e))?;
    listener.set_nonblocking(true)
        .map_err(|e| format!("set_nonblocking: {}", e))?;
    let port = listener.local_addr()
        .map_err(|e| format!("Failed to get port: {}", e))?.port();

    let rt = tauri::async_runtime::handle();
    // NFC: rt.spawn consumes `rt`, clone for reuse
    rt.clone().spawn(async move {
        let stream = match tokio::net::TcpListener::from_std(listener) {
            Ok(tl) => match tl.accept().await {
                Ok((s, _)) => s,
                Err(_) => return,
            },
            Err(_) => return,
        };
        let ws = match accept_async(stream).await {
            Ok(ws) => ws,
            Err(_) => return,
        };
        let (mut ws_sink, mut ws_stream) = ws.split();

        // Channel: PTY reader → WS (unidirectional, no Mutex)
        let (tx, mut rx) = tokio::sync::mpsc::channel::<Vec<u8>>(256);

        // Task 1: stream read (blocking) → channel
        let tx1 = tx.clone();
        // Drop the original sender: Task 1 must be the sole sender, so that
        // when the stream hits EOF (shell exit, serial unplug) the channel
        // closes, Task 2 ends, and the WebSocket closes — this is how the
        // frontend detects a disconnected session.
        drop(tx);
        rt.spawn(async move {
            let _ = tokio::task::spawn_blocking(move || {
                let mut buf = [0u8; 16384];
                loop {
                    if let Some(c) = &cancel {
                        if c.load(Ordering::Relaxed) { break; }
                    }
                    match reader.read(&mut buf) {
                        Ok(0) => break,
                        Ok(n) => {
                            if tx1.blocking_send(buf[..n].to_vec()).is_err() { break; }
                        }
                        Err(e) => {
                            // Serial reads use a timeout to poll `cancel`
                            if e.kind() == std::io::ErrorKind::TimedOut { continue; }
                            break;
                        }
                    }
                }
            }).await;
        });

        // Task 2: channel → WS sink (fully async)
        rt.spawn(async move {
            while let Some(data) = rx.recv().await {
                if ws_sink.send(WsMessage::Binary(data)).await.is_err() { break; }
            }
            // Stream ended (shell exit / serial unplug): send a proper Close
            // frame so the frontend socket fires 'close' — merely dropping
            // the sink half would leave the TCP connection open silently.
            let _ = ws_sink.close().await;
        });

        // Task 3: WS stream → stream write
        // writer is Arc<Mutex<>> so it can be shared across spawn_blocking calls
        let pty_w = Arc::new(Mutex::new(writer));
        rt.spawn(async move {
            while let Some(Ok(msg)) = ws_stream.next().await {
                let data = match msg {
                    WsMessage::Binary(d) => d,
                    WsMessage::Text(t) => t.into_bytes(),
                    WsMessage::Close(_) => break,
                    _ => continue,
                };
                let w = pty_w.clone();
                let result = tokio::task::spawn_blocking(move || {
                    let mut guard = match w.lock() { Ok(g) => g, Err(_) => return };
                    if guard.write_all(&data).is_err() { return; }
                    let _ = guard.flush();
                }).await;
                if result.is_err() { break; }
            }
        });
    });

    Ok(port)
}
