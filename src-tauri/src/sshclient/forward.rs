//! Port forwarding: TCP <-> channel bridging, -L/-R/-D forward
//! (re)establishment, the minimal SOCKS5 handshake, and the forward commands.

use std::sync::atomic::Ordering;
use std::sync::Arc;

use russh::client::{self, Handle};

use super::hostkey::SshHandler;
use super::{ForwardEntry, ForwardInfo, SshSession};
use crate::state::AppState;

// ── TCP <-> channel bridging (port forwarding) ───────────────────────

/// Pump bytes both ways between a plain TCP stream and an SSH channel
/// (direct-tcpip or forwarded-tcpip). Returns when either side ends.
/// Generic so the in-process test server can reuse it for its own channels.
pub(crate) async fn bridge_tcp_channel<S>(stream: tokio::net::TcpStream, channel: russh::Channel<S>)
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
                    if tokio::io::AsyncWriteExt::write_all(&mut tcp_write, &data)
                        .await
                        .is_err()
                    {
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

pub(crate) async fn reapply_forwards(handle: &Arc<Handle<SshHandler>>, session: &SshSession) {
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
            "dynamic" => {
                if let Some(task) = spawn_dynamic_forward(handle, session, &info).await {
                    if let Ok(mut t) = session.forwards.lock() {
                        if let Some(entry) = t.get_mut(&info.forward_id) {
                            entry.abort = Some(task);
                        }
                    }
                }
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
    let listener = tokio::net::TcpListener::bind((info.listen_host.as_str(), info.listen_port))
        .await
        .ok()?;
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

/// Bind the local listener for a -D dynamic forward (SOCKS5, no-auth
/// CONNECT only) and spawn its accept loop. Each accepted connection
/// negotiates SOCKS5, then opens a direct-tcpip channel to the requested
/// destination.
async fn spawn_dynamic_forward(
    handle: &Arc<Handle<SshHandler>>,
    session: &SshSession,
    info: &ForwardInfo,
) -> Option<tauri::async_runtime::JoinHandle<()>> {
    let listener = tokio::net::TcpListener::bind((info.listen_host.as_str(), info.listen_port))
        .await
        .ok()?;
    let handle = handle.clone();
    let notify = session.close_notify.clone();
    Some(tauri::async_runtime::spawn(async move {
        loop {
            tokio::select! {
                _ = notify.notified() => break,
                accepted = listener.accept() => {
                    match accepted {
                        Ok((stream, _peer)) => {
                            let handle = handle.clone();
                            tauri::async_runtime::spawn(async move {
                                if let Some((ch, stream)) = socks5_connect(stream, &handle).await {
                                    bridge_tcp_channel(stream, ch).await
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

/// Minimal SOCKS5 server handshake (no authentication, CONNECT only).
/// On success returns the opened SSH channel plus the client stream,
/// ready to bridge; the success reply is already sent.
async fn socks5_connect(
    mut stream: tokio::net::TcpStream,
    handle: &Arc<Handle<SshHandler>>,
) -> Option<(russh::Channel<client::Msg>, tokio::net::TcpStream)> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    // Greeting: VER=5 NMETHODS METHODS... — require the no-auth method.
    if stream.read_u8().await.ok()? != 5 {
        return None;
    }
    let nmethods = stream.read_u8().await.ok()?;
    let mut methods = vec![0u8; nmethods as usize];
    stream.read_exact(&mut methods).await.ok()?;
    if !methods.contains(&0) {
        stream.write_all(&[5, 0xFF]).await.ok()?;
        return None;
    }
    stream.write_all(&[5, 0]).await.ok()?;
    // Request: VER=5 CMD=1(connect) RSV ATYP DST.ADDR DST.PORT
    if stream.read_u8().await.ok()? != 5 {
        return None;
    }
    if stream.read_u8().await.ok()? != 1 {
        return None; // CONNECT only
    }
    let _rsv = stream.read_u8().await.ok()?;
    let atyp = stream.read_u8().await.ok()?;
    let host = match atyp {
        1 => {
            let mut b = [0u8; 4];
            stream.read_exact(&mut b).await.ok()?;
            std::net::Ipv4Addr::from(b).to_string()
        }
        3 => {
            let len = stream.read_u8().await.ok()?;
            let mut b = vec![0u8; len as usize];
            stream.read_exact(&mut b).await.ok()?;
            String::from_utf8(b).ok()?
        }
        4 => {
            let mut b = [0u8; 16];
            stream.read_exact(&mut b).await.ok()?;
            std::net::Ipv6Addr::from(b).to_string()
        }
        _ => return None,
    };
    let port = stream.read_u16().await.ok()?;
    let ch = handle
        .channel_open_direct_tcpip(host, port as u32, "127.0.0.1", 0)
        .await
        .ok()?;
    // Success reply: VER=5 REP=0 RSV ATYP=IPv4 BND.ADDR=0.0.0.0 BND.PORT=0
    stream
        .write_all(&[5, 0, 0, 1, 0, 0, 0, 0, 0, 0])
        .await
        .ok()?;
    Some((ch, stream))
}

pub(crate) async fn add_forward(
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
                    .ok_or_else(|| {
                        format!(
                            "Failed to listen on {}:{}",
                            info.listen_host, info.listen_port
                        )
                    })?,
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
        "dynamic" => {
            let guard = session.live.lock().await;
            let live = guard.as_ref().ok_or("session not connected")?;
            Some(
                spawn_dynamic_forward(&live.handle, session, &info)
                    .await
                    .ok_or_else(|| {
                        format!(
                            "Failed to listen on {}:{}",
                            info.listen_host, info.listen_port
                        )
                    })?,
            )
        }
        _ => return Err("kind must be \"local\", \"remote\" or \"dynamic\"".into()),
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
        table
            .get(&id)
            .cloned()
            .ok_or("not an embedded ssh session")?
    };
    add_forward(
        &session,
        &kind,
        listen_host,
        listen_port,
        target_host,
        target_port,
    )
    .await
}

#[tauri::command]
pub async fn ssh_forward_remove(
    state: tauri::State<'_, AppState>,
    id: String,
    forward_id: u64,
) -> Result<(), String> {
    let session = {
        let table = state.ssh_sessions.lock().map_err(|e| e.to_string())?;
        table
            .get(&id)
            .cloned()
            .ok_or("not an embedded ssh session")?
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
                    .cancel_tcpip_forward(
                        entry.info.listen_host.clone(),
                        entry.info.listen_port as u32,
                    )
                    .await;
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub fn ssh_forward_list(
    state: tauri::State<AppState>,
    id: String,
) -> Result<Vec<ForwardInfo>, String> {
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
