//! Integration tests against an in-process russh server.

use super::*;
use std::path::PathBuf;
use std::time::Duration;

use crate::relay::{register_session, WsHub};
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

/// Which remote shell the exec simulation answers to.
#[derive(Clone, Copy, PartialEq)]
enum ExecSim {
    Posix,
    WindowsCmd,
    WindowsPs,
    // Windows hosts with Git for Windows on PATH: the default shell
    // (cmd / PowerShell) spawns sh.exe for the `sh -c "uname -s"`
    // probe, so that probe exits 0 even though the host is Windows.
    WindowsCmdWithSh,
    WindowsPsWithSh,
}

impl ExecSim {
    fn answers_sh(self) -> bool {
        matches!(
            self,
            ExecSim::Posix | ExecSim::WindowsCmdWithSh | ExecSim::WindowsPsWithSh
        )
    }
    fn answers_cmd(self) -> bool {
        matches!(self, ExecSim::WindowsCmd | ExecSim::WindowsCmdWithSh)
    }
    fn answers_ps(self) -> bool {
        matches!(self, ExecSim::WindowsPs | ExecSim::WindowsPsWithSh)
    }
}

struct ServerState {
    sizes: Vec<(u32, u32)>,
    direct_tcpip_target: (String, u16),
    // Only the shell channel echoes; direct-tcpip channels are bridged.
    shell_channel: Option<russh::ChannelId>,
    // When set, shell_request streams this payload (and no echo happens
    // on the shell channel) — the issue #1 flood repro.
    flood: Option<Arc<Vec<u8>>>,
    // Exec simulation for install_pubkey tests.
    exec_sim: ExecSim,
    exec_log: Vec<String>,
    // When true, the "is the key already authorized" probe succeeds.
    key_present: bool,
}

/// Minimal in-process SSH server: password auth (u/pw), echo shell on
/// session channels, and direct-tcpip bridged to a fixed target.
#[derive(Clone)]
struct TestServer {
    state: Arc<parking_lot::Mutex<ServerState>>,
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
        let (host, _) = self.state.lock().direct_tcpip_target.clone();
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
        let flood = self.state.lock().flood.clone();
        self.state.lock().shell_channel = Some(channel);
        session.channel_success(channel)?;
        session.data(channel, b"shell-ready\r\n".to_vec())?;
        if let Some(flood) = flood {
            // Stream the burst the way a pty flood arrives: a few large
            // writes, then a trailing "remote finished" marker.
            for chunk in flood.chunks(32 * 1024) {
                session.data(channel, chunk.to_vec())?;
            }
            session.data(channel, b"=== SERVER DONE ===\r\n".to_vec())?;
        }
        Ok(())
    }

    async fn data(
        &mut self,
        channel: russh::ChannelId,
        data: &[u8],
        session: &mut server::Session,
    ) -> Result<(), Self::Error> {
        let st = self.state.lock();
        if st.shell_channel != Some(channel) {
            return Ok(()); // forwarding channel — the bridge handles it
        }
        if st.flood.is_some() {
            return Ok(()); // flood channel swallows upstream "replies"
        }
        drop(st);
        let mut reply = b"echo:".to_vec();
        reply.extend_from_slice(data);
        session.data(channel, reply)?;
        Ok(())
    }

    /// Emulates a target OS for install_pubkey: probe commands exit 0
    /// only for the simulated shell; everything else is logged and
    /// succeeds, except the "key already present" probes which honor
    /// state.key_present.
    async fn exec_request(
        &mut self,
        channel: russh::ChannelId,
        data: &[u8],
        session: &mut server::Session,
    ) -> Result<(), Self::Error> {
        let cmd = String::from_utf8_lossy(data).to_string();
        let (sim, key_present) = {
            let mut st = self.state.lock();
            st.exec_log.push(cmd.clone());
            (st.exec_sim, st.key_present)
        };
        let status = if cmd.contains("uname -s") {
            !sim.answers_sh() as u32
        } else if cmd.trim() == "ver" {
            !sim.answers_cmd() as u32
        } else if cmd.contains("$PSVersionTable") {
            !sim.answers_ps() as u32
        } else if cmd.contains("grep -qxF")
            || cmd.contains("findstr")
            || cmd.contains("Get-Content")
        {
            (!key_present) as u32
        } else {
            0 // prepare / append
        };
        session.channel_success(channel)?;
        // L8 regression: a multi-byte UTF-8 char split across two Data
        // chunks must decode cleanly (per-chunk lossy decode → U+FFFD).
        if cmd.contains("emit-split-utf8") {
            let bytes = "ok:中".as_bytes(); // 中 = 3 bytes
            let split = bytes.len() - 1; // break inside the char
            session.data(channel, bytes[..split].to_vec())?;
            session.data(channel, bytes[split..].to_vec())?;
        }
        // Real sshd order: stdout EOF arrives as soon as the child's
        // pipes close, BEFORE the process is reaped and exit-status is
        // sent. This ordering caught the exec_capture Eof race.
        session.eof(channel)?;
        session.exit_status_request(channel, status)?;
        session.close(channel)?;
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
        self.state.lock().sizes.push((cols, rows));
        Ok(())
    }
}

/// Plain TCP echo server — the forwarding target.
async fn spawn_tcp_echo() -> u16 {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    tauri::async_runtime::spawn(async move {
        loop {
            let Ok((mut s, _)) = listener.accept().await else {
                break;
            };
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
    std::env::temp_dir().join(format!(
        "tterm-test-known-hosts-{}-{}",
        std::process::id(),
        tag
    ))
}

/// Full round trip against the in-process server: password auth, shell
/// echo, window_change, and a dynamically added local (-L) forward.
#[test]
fn embedded_ssh_end_to_end() {
    tauri::async_runtime::block_on(async {
        let echo_port = spawn_tcp_echo().await;
        let server_state = Arc::new(parking_lot::Mutex::new(ServerState {
            sizes: Vec::new(),
            direct_tcpip_target: ("127.0.0.1".into(), echo_port),
            shell_channel: None,
            flood: None,
            exec_sim: ExecSim::Posix,
            exec_log: Vec::new(),
            key_present: false,
        }));

        // Bind the SSH server.
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let ssh_port = listener.local_addr().unwrap().port();
        {
            let state = server_state.clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    let Ok((stream, _)) = listener.accept().await else {
                        break;
                    };
                    let key = russh::keys::PrivateKey::from_openssh(TEST_HOST_KEY).unwrap();
                    let config = Arc::new(server::Config {
                        keys: vec![key],
                        auth_rejection_time: Duration::ZERO,
                        ..Default::default()
                    });
                    let handler = TestServer {
                        state: state.clone(),
                    };
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
        let (reader, mut writer) =
            connect_session_with(&session, Arc::new(TestPrompter), Some(kh.clone()))
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
            if server_state.lock().sizes.contains(&(132, 43)) {
                break;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        assert!(
            server_state.lock().sizes.contains(&(132, 43)),
            "server saw window_change"
        );

        // Dynamic local forward: add at runtime, then push bytes through.
        let fwd_id = add_forward(
            &session,
            "local",
            "127.0.0.1".into(),
            0,
            "127.0.0.1".into(),
            echo_port,
        )
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
                add_forward(
                    &session,
                    "local",
                    "127.0.0.1".into(),
                    free,
                    "127.0.0.1".into(),
                    echo_port,
                )
                .await
                .expect("add forward fixed port");
                free
            }
            Some(p) => p,
        };
        tokio::time::sleep(Duration::from_millis(200)).await;
        let mut proxied = tokio::net::TcpStream::connect(("127.0.0.1", listen_port))
            .await
            .unwrap();
        tokio::io::AsyncWriteExt::write_all(&mut proxied, b"tunnel")
            .await
            .unwrap();
        let mut got = vec![0u8; 6];
        tokio::time::timeout(
            Duration::from_secs(5),
            tokio::io::AsyncReadExt::read_exact(&mut proxied, &mut got),
        )
        .await
        .expect("tunnel reply in time")
        .expect("tunnel reply");
        assert_eq!(
            &got, b"tunnel",
            "bytes round-tripped through the SSH tunnel"
        );

        kill_ssh_session(&session);
    });
}

/// Dynamic (-D) forward: a SOCKS5 client handshake through the local
/// listener must land on a direct-tcpip channel and bridge bytes.
#[test]
fn dynamic_forward_socks5_round_trip() {
    tauri::async_runtime::block_on(async {
        let echo_port = spawn_tcp_echo().await;
        let server_state = Arc::new(parking_lot::Mutex::new(ServerState {
            sizes: Vec::new(),
            direct_tcpip_target: ("127.0.0.1".into(), echo_port),
            shell_channel: None,
            flood: None,
            exec_sim: ExecSim::Posix,
            exec_log: Vec::new(),
            key_present: false,
        }));

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let ssh_port = listener.local_addr().unwrap().port();
        {
            let state = server_state.clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    let Ok((stream, _)) = listener.accept().await else {
                        break;
                    };
                    let key = russh::keys::PrivateKey::from_openssh(TEST_HOST_KEY).unwrap();
                    let config = Arc::new(server::Config {
                        keys: vec![key],
                        auth_rejection_time: Duration::ZERO,
                        ..Default::default()
                    });
                    let handler = TestServer {
                        state: state.clone(),
                    };
                    tauri::async_runtime::spawn(async move {
                        let _ = server::run_stream(config, stream, handler).await;
                    });
                }
            });
        }

        let kh = temp_known_hosts("dyn");
        let _ = std::fs::remove_file(&kh);
        let session = test_session(ssh_port);
        let _ = connect_session_with(&session, Arc::new(TestPrompter), Some(kh))
            .await
            .expect("connect + auth + shell");

        // Add a dynamic forward on a fixed free port.
        let probe = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let socks_port = probe.local_addr().unwrap().port();
        drop(probe);
        add_forward(
            &session,
            "dynamic",
            "127.0.0.1".into(),
            socks_port,
            String::new(),
            0,
        )
        .await
        .expect("add dynamic forward");
        tokio::time::sleep(Duration::from_millis(200)).await;

        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let mut socks = tokio::net::TcpStream::connect(("127.0.0.1", socks_port))
            .await
            .unwrap();
        // Greeting: one method, no-auth.
        socks.write_all(&[5, 1, 0]).await.unwrap();
        let mut reply = [0u8; 2];
        socks.read_exact(&mut reply).await.unwrap();
        assert_eq!(reply, [5, 0], "no-auth method accepted");
        // CONNECT to 127.0.0.1:echo_port (domain form, like a browser).
        let mut req = vec![5, 1, 0, 3, 9];
        req.extend_from_slice(b"127.0.0.1");
        req.extend_from_slice(&echo_port.to_be_bytes());
        socks.write_all(&req).await.unwrap();
        let mut head = [0u8; 4];
        socks.read_exact(&mut head).await.unwrap();
        assert_eq!(head, [5, 0, 0, 1], "connect granted");
        let mut bnd = [0u8; 6]; // BND.ADDR + BND.PORT
        socks.read_exact(&mut bnd).await.unwrap();

        socks.write_all(b"tunnel").await.unwrap();
        let mut got = vec![0u8; 6];
        tokio::time::timeout(Duration::from_secs(5), socks.read_exact(&mut got))
            .await
            .expect("reply in time")
            .expect("reply");
        assert_eq!(
            &got, b"tunnel",
            "bytes round-tripped via SOCKS5 + direct-tcpip"
        );

        kill_ssh_session(&session);
    });
}

/// Issue rede97/tterm#1 regression: the captured omp startup burst
/// (93,723 bytes) must flow through the ENTIRE backend chain — russh
/// channel → SshReader → relay hub → WebSocket client — completely and
/// without wedging, even while the client concurrently pushes "query
/// reply" bytes upstream (xterm answers the DA/DECRQM queries contained
/// in the burst; those replies ride the same session in the real setup).
///
/// The byte stream is byte-agnostic to the backend, so what this pins is
/// the transport contract: a fast multi-chunk flood + interleaved upstream
/// writes never deadlocks the pumps. A wedge shows up here as the read
/// deadline expiring before the SERVER DONE marker arrives.
#[test]
fn ssh_flood_delivers_entire_omp_stream() {
    use tokio_tungstenite::tungstenite;

    // The exact byte stream attached to the issue (raw — the same fixture
    // the frontend regression test parses).
    static FLOOD: &[u8] = include_bytes!("../../../tests/fixtures/omp-startup-stream.bin");
    const DONE: &[u8] = b"=== SERVER DONE ===\r\n";
    const BANNER: &[u8] = b"shell-ready\r\n";

    tauri::async_runtime::block_on(async {
        // In-process SSH server that floods the captured stream on shell open.
        let server_state = Arc::new(parking_lot::Mutex::new(ServerState {
            sizes: Vec::new(),
            direct_tcpip_target: ("127.0.0.1".into(), 1),
            shell_channel: None,
            flood: Some(Arc::new(FLOOD.to_vec())),
            exec_sim: ExecSim::Posix,
            exec_log: Vec::new(),
            key_present: false,
        }));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let ssh_port = listener.local_addr().unwrap().port();
        {
            let state = server_state.clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    let Ok((stream, _)) = listener.accept().await else {
                        break;
                    };
                    let key = russh::keys::PrivateKey::from_openssh(TEST_HOST_KEY).unwrap();
                    let config = Arc::new(server::Config {
                        keys: vec![key],
                        auth_rejection_time: Duration::ZERO,
                        ..Default::default()
                    });
                    let handler = TestServer {
                        state: state.clone(),
                    };
                    tauri::async_runtime::spawn(async move {
                        let _ = server::run_stream(config, stream, handler).await;
                    });
                }
            });
        }

        // Client session through the real connect path…
        let kh = temp_known_hosts("flood");
        let _ = std::fs::remove_file(&kh);
        let session = test_session(ssh_port);
        let (reader, writer) = connect_session_with(&session, Arc::new(TestPrompter), Some(kh))
            .await
            .expect("connect + auth + shell");

        // …then the real relay path to a real WebSocket client (the
        // frontend stand-in, as in relay.rs's hub tests).
        let hub = WsHub::start().expect("hub start");
        std::thread::sleep(Duration::from_millis(150));
        register_session(&hub, "tab-flood", reader, writer, None).unwrap();

        let stream = std::net::TcpStream::connect(format!("127.0.0.1:{}", hub.port)).unwrap();
        let (mut ws, _resp) = tungstenite::client(
            format!(
                "ws://127.0.0.1:{}/pty/tab-flood?token={}",
                hub.port, hub.token
            ),
            stream,
        )
        .expect("handshake");
        ws.get_mut()
            .set_read_timeout(Some(Duration::from_secs(15)))
            .unwrap();

        // Once the flood starts arriving, interleave upstream "query
        // replies" exactly like the frontend would emit them mid-parse.
        let expected_len = BANNER.len() + FLOOD.len() + DONE.len();
        let mut collected: Vec<u8> = Vec::with_capacity(expected_len);
        let mut replies_sent = false;
        let deadline = std::time::Instant::now() + Duration::from_secs(30);
        while !collected.ends_with(DONE) {
            assert!(
                std::time::Instant::now() < deadline,
                "delivery wedged: {} of {} bytes arrived",
                collected.len(),
                expected_len
            );
            let msg = ws.read().expect("ws read before DONE marker");
            let data = msg.into_data();
            collected.extend_from_slice(&data);
            if !replies_sent && collected.len() > 1024 {
                replies_sent = true;
                // DA + DECRP answers, ~130 bytes total, as xterm emits them.
                for _ in 0..7 {
                    ws.send(tungstenite::Message::Binary(b"\x1b[?1;2c".to_vec()))
                        .unwrap();
                }
                for mode in [2026u32, 2031, 2048, 1010, 1011] {
                    ws.send(tungstenite::Message::Binary(
                        format!("\x1b[?{};0$y", mode).into_bytes(),
                    ))
                    .unwrap();
                }
            }
        }

        // Byte-exact delivery: banner, the full captured stream, marker.
        let mut expected = Vec::with_capacity(expected_len);
        expected.extend_from_slice(BANNER);
        expected.extend_from_slice(FLOOD);
        expected.extend_from_slice(DONE);
        assert_eq!(collected.len(), expected_len, "byte count mismatch");
        assert_eq!(collected, expected, "stream corrupted in transit");

        // Upstream replies really reached the server (consumed by data()).
        assert!(replies_sent);

        kill_ssh_session(&session);
    });
}

/// SSH server with the exec simulation configured, for install tests.
async fn spawn_exec_server(
    sim: ExecSim,
    key_present: bool,
) -> (u16, Arc<parking_lot::Mutex<ServerState>>) {
    let server_state = Arc::new(parking_lot::Mutex::new(ServerState {
        sizes: Vec::new(),
        direct_tcpip_target: ("127.0.0.1".into(), 1),
        shell_channel: None,
        flood: None,
        exec_sim: sim,
        exec_log: Vec::new(),
        key_present,
    }));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let state = server_state.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            let Ok((stream, _)) = listener.accept().await else {
                break;
            };
            let key = russh::keys::PrivateKey::from_openssh(TEST_HOST_KEY).unwrap();
            let config = Arc::new(server::Config {
                keys: vec![key],
                auth_rejection_time: Duration::ZERO,
                ..Default::default()
            });
            let handler = TestServer {
                state: state.clone(),
            };
            tauri::async_runtime::spawn(async move {
                let _ = server::run_stream(config, stream, handler).await;
            });
        }
    });
    (port, server_state)
}

#[test]
fn keygen_generates_loadable_keypairs() {
    let dir = std::env::temp_dir().join(format!("tterm-test-keygen-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();

    // ed25519: private half loads, public half matches the listing.
    let info = keygen_in(&dir, "ed25519", "id_test", None).expect("keygen ed25519");
    assert_eq!(info.name, "id_test");
    assert!(
        info.fingerprint.starts_with("SHA256:"),
        "{}",
        info.fingerprint
    );
    let key = russh::keys::load_secret_key(&info.path, None).expect("load private key");
    assert_eq!(key.public_key().to_openssh().unwrap(), info.public_key);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(&info.path).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600, "private key must be 0600");
    }

    // Listing finds real keypairs, skips orphan .pub files.
    std::fs::write(dir.join("orphan.pub"), format!("{}\n", info.public_key)).unwrap();
    let listed = list_keys_in(&dir);
    assert_eq!(listed.len(), 1, "orphan .pub must be skipped: {listed:?}");

    // Name validation, duplicate refusal, passphrase round-trip.
    assert!(keygen_in(&dir, "ed25519", "bad/name", None).is_err());
    assert!(keygen_in(&dir, "ed25519", "id_test", None).is_err());
    let enc = keygen_in(&dir, "ed25519", "id_enc", Some("pw".into())).expect("keygen encrypted");
    assert!(russh::keys::load_secret_key(&enc.path, None).is_err());
    assert!(russh::keys::load_secret_key(&enc.path, Some("pw")).is_ok());

    // RSA option produces an RSA key (slow: 4096-bit generation).
    let rsa = keygen_in(&dir, "rsa", "id_rsa_test", None).expect("keygen rsa");
    assert!(rsa.public_key.starts_with("ssh-rsa "), "{}", rsa.public_key);

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn install_pubkey_probes_shell_and_appends() {
    tauri::async_runtime::block_on(async {
        let pub_key = russh::keys::PrivateKey::from_openssh(TEST_HOST_KEY)
            .unwrap()
            .public_key()
            .to_openssh()
            .unwrap();
        let install = |port: u16, target_os: Option<String>, tag: &str| {
            let pub_key = pub_key.clone();
            let kh = temp_known_hosts(tag);
            let _ = std::fs::remove_file(&kh);
            async move {
                let spec = test_session(port).spec;
                install_pubkey_with(&spec, &pub_key, target_os, Arc::new(TestPrompter), Some(kh))
                    .await
            }
        };

        // POSIX target: the sh probe answers, sh syntax is used.
        let (port, state) = spawn_exec_server(ExecSim::Posix, false).await;
        let res = install(port, None, "inst-posix")
            .await
            .expect("install posix");
        assert_eq!(res.outcome, "installed");
        assert_eq!(res.shell, "posix");
        let log = state.lock().exec_log.join("\n");
        assert!(log.contains("uname -s"), "probe ran: {log}");
        assert!(log.contains("mkdir -p ~/.ssh"), "prepare ran: {log}");
        assert!(
            log.contains(">> ~/.ssh/authorized_keys"),
            "append ran: {log}"
        );

        // Already-authorized key: reported, append skipped.
        let (port, state) = spawn_exec_server(ExecSim::Posix, true).await;
        let res = install(port, None, "inst-already")
            .await
            .expect("install already");
        assert_eq!(res.outcome, "already");
        let log = state.lock().exec_log.join("\n");
        assert!(log.contains("grep -qxF"), "contains probe ran: {log}");
        assert!(
            !log.contains(">> ~/.ssh/authorized_keys"),
            "append skipped: {log}"
        );

        // Windows targets: cmd answers `ver`, powershell $PSVersionTable.
        let (port, state) = spawn_exec_server(ExecSim::WindowsCmd, false).await;
        let res = install(port, None, "inst-cmd").await.expect("install cmd");
        assert_eq!(res.shell, "windows-cmd");
        let log = state.lock().exec_log.join("\n");
        assert!(
            log.contains("%USERPROFILE%\\.ssh\\authorized_keys"),
            "cmd append: {log}"
        );

        let (port, state) = spawn_exec_server(ExecSim::WindowsPs, false).await;
        let res = install(port, None, "inst-ps").await.expect("install ps");
        assert_eq!(res.shell, "windows-powershell");
        let log = state.lock().exec_log.join("\n");
        assert!(log.contains("Add-Content"), "ps append: {log}");

        // Regression: Windows hosts with Git for Windows on PATH answer
        // the `sh -c "uname -s"` probe (the default shell spawns sh.exe).
        // Detection must still pick the real default shell — the POSIX
        // `&&` prepare chain is a syntax error on PowerShell 5.1.
        let (port, state) = spawn_exec_server(ExecSim::WindowsPsWithSh, false).await;
        let res = install(port, None, "inst-ps-git")
            .await
            .expect("install ps+git");
        assert_eq!(res.shell, "windows-powershell");
        let log = state.lock().exec_log.join("\n");
        assert!(log.contains("Add-Content"), "ps append: {log}");
        assert!(!log.contains("chmod"), "posix steps must not run: {log}");

        let (port, state) = spawn_exec_server(ExecSim::WindowsCmdWithSh, false).await;
        let res = install(port, None, "inst-cmd-git")
            .await
            .expect("install cmd+git");
        assert_eq!(res.shell, "windows-cmd");
        let log = state.lock().exec_log.join("\n");
        assert!(
            log.contains("%USERPROFILE%\\.ssh\\authorized_keys"),
            "cmd append: {log}"
        );

        // OS restriction narrows the probes: "windows" on a posix target
        // must fail detection instead of falling back to sh syntax.
        let (port, _state) = spawn_exec_server(ExecSim::Posix, false).await;
        let err = install(port, Some("windows".into()), "inst-restrict")
            .await
            .expect_err("restricted detection must fail");
        assert!(err.contains("could not detect"), "{err}");
    });
}

/// L8 regression: exec_capture must reassemble multi-byte UTF-8 split
/// across channel Data chunks (per-chunk lossy decode used to yield U+FFFD).
#[test]
fn exec_capture_decodes_split_utf8() {
    tauri::async_runtime::block_on(async {
        let (port, _state) = spawn_exec_server(ExecSim::Posix, false).await;
        let spec = test_session(port).spec;
        let kh = temp_known_hosts("split-utf8");
        let _ = std::fs::remove_file(&kh);

        let mut config = client::Config::default();
        config.inactivity_timeout = None;
        let handler = SshHandler {
            host: spec.hostname.clone(),
            port: spec.port,
            prompter: Arc::new(TestPrompter),
            known_hosts: Some(kh.clone()),
            forwards: Arc::new(Mutex::new(HashMap::new())),
        };
        let mut handle = client::connect(
            Arc::new(config),
            (spec.hostname.as_str(), spec.port),
            handler,
        )
        .await
        .expect("connect");
        let prompter: Arc<dyn Prompter> = Arc::new(TestPrompter);
        authenticate(&mut handle, &spec, &prompter, &Arc::new(Mutex::new(None)))
            .await
            .expect("auth");

        let (status, out) = exec_capture(&handle, "emit-split-utf8")
            .await
            .expect("exec");
        assert_eq!(status, 0);
        assert_eq!(out, "ok:中", "split multi-byte char must survive: {out:?}");

        let _ = std::fs::remove_file(&kh);
    });
}

/// Live smoke test against a real SSH host — ignored by default.
///
///     TTERM_LIVE=user:password@host[:port] cargo test live_install_pubkey -- --ignored --nocapture
///
/// Generates a throwaway key pair, installs the public half through the
/// real auto-detect path, and prints the detected shell + outcome. The
/// installed authorized_keys line is left on the server.
#[test]
#[ignore = "needs a real SSH host via TTERM_LIVE=user:password@host[:port]"]
fn live_install_pubkey() {
    tauri::async_runtime::block_on(async {
        let live = std::env::var("TTERM_LIVE").expect("set TTERM_LIVE=user:password@host[:port]");
        let (creds, hostport) = live
            .rsplit_once('@')
            .expect("TTERM_LIVE needs user:pass@host");
        let (user, password) = creds
            .split_once(':')
            .expect("TTERM_LIVE needs user:password@host");
        let (hostname, port) = match hostport.rsplit_once(':') {
            Some((h, p)) => (h.to_string(), p.parse().expect("bad port")),
            None => (hostport.to_string(), 22),
        };

        struct LivePrompter(String);
        impl Prompter for LivePrompter {
            fn ask_secret(&self, _kind: &str, _prompt: String) -> BoxFuture<Option<String>> {
                let pw = self.0.clone();
                Box::pin(async move { Some(pw) })
            }
            fn confirm_host_key(&self, info: HostKeyPrompt) -> BoxFuture<bool> {
                Box::pin(async move {
                    eprintln!("accepting host key {} {}", info.key_type, info.fingerprint);
                    true
                })
            }
        }

        let dir = std::env::temp_dir().join(format!("tterm-live-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let key = keygen_in(&dir, "ed25519", "id_live", None).expect("keygen");

        let spec = EmbeddedSshSpec {
            hostname: hostname.clone(),
            port,
            user: user.to_string(),
            identity_file: None, // mirror the app: probe default ~/.ssh keys first
        };
        let kh = temp_known_hosts("live");
        let _ = std::fs::remove_file(&kh);
        let res = install_pubkey_with(
            &spec,
            &key.public_key,
            None,
            Arc::new(LivePrompter(password.to_string())),
            Some(kh),
        )
        .await
        .expect("live install failed");
        eprintln!(
            "live install on {user}@{hostname}:{port}: shell={} outcome={}",
            res.shell, res.outcome
        );

        let _ = std::fs::remove_dir_all(&dir);
    });
}
