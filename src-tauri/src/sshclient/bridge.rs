//! Pump bytes both ways between a plain TCP stream and an SSH channel
//! (direct-tcpip or forwarded-tcpip). Shared by local forwards, remote
//! forwards (via hostkey.rs), and the in-process test server — neutral
//! home so hostkey and forward do not import each other for it.

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
