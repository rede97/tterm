//! Demo TTY (debug builds only — entire file gated in lib.rs).
//! A mock terminal session with no child process: a thread generates animated
//! TUI frames + OSC 9;4 progress sequences; keystrokes control playback.
//! Reuses the WS relay hub via in-memory Read/Write adapters.

use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::Emitter;

use crate::relay::{register_session, ReconnectHooks};
use crate::state::{AppState, SerialSession, SessionState, WsConnectResult};

pub(crate) struct DemoReader {
    rx: std::sync::mpsc::Receiver<Vec<u8>>,
    cur: std::collections::VecDeque<u8>,
}

impl DemoReader {
    pub(crate) fn new(rx: std::sync::mpsc::Receiver<Vec<u8>>) -> Self {
        Self {
            rx,
            cur: std::collections::VecDeque::new(),
        }
    }
}

impl Read for DemoReader {
    fn read(&mut self, out: &mut [u8]) -> std::io::Result<usize> {
        while self.cur.is_empty() {
            match self.rx.recv() {
                Ok(frame) => self.cur.extend(frame),
                Err(_) => return Ok(0), // demo thread exited -> EOF
            }
        }
        let n = self.cur.len().min(out.len());
        for slot in out.iter_mut().take(n) {
            *slot = self.cur.pop_front().unwrap();
        }
        Ok(n)
    }
}

pub(crate) struct DemoWriter {
    pub(crate) tx: std::sync::mpsc::Sender<u8>,
}

impl Write for DemoWriter {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        for &b in buf {
            let _ = self.tx.send(b);
        }
        Ok(buf.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

// One animation cycle: 400 ticks x 50ms = 20s.
//   0..40    indeterminate (state 3) + spinner
//   40..340  normal progress 0->100% (state 1)
//   340..360 warning (state 4)
//   360..380 error (state 2)
//   380..400 hidden (state 0), done message
pub(crate) fn render_demo_frame(tick: u64) -> Vec<u8> {
    const SPINNER: [char; 4] = ['|', '/', '-', '\\'];
    let t = tick % 400;
    let (state, progress, phase): (u8, u32, &str) = if t < 40 {
        (3, 0, "indeterminate")
    } else if t < 340 {
        (1, ((t - 40) / 3) as u32, "running")
    } else if t < 360 {
        (4, 100, "warning")
    } else if t < 380 {
        (2, 100, "error")
    } else {
        (0, 100, "done")
    };
    let pct = progress.min(100) as usize;
    let filled = pct / 5; // 20-cell bar
    let bar = format!("{}{}", "#".repeat(filled), "-".repeat(20 - filled));
    let spin = SPINNER[(tick as usize / 2) % 4];

    let mut s = String::new();
    // OSC 9;4 progress report (BEL-terminated)
    s.push_str(&format!("\x1b]9;4;{};{}\x07", state, progress));
    // Repaint frame
    s.push_str("\x1b[H");
    s.push_str("\x1b[K\x1b[1;36m== TTerm Demo TTY ==\x1b[0m  \x1b[2m(space=pause r=reset q=quit)\x1b[0m\r\n");
    s.push_str("\x1b[K\r\n");
    s.push_str(&format!(
        "\x1b[K phase: \x1b[1m{}\x1b[0m {}\r\n",
        phase, spin
    ));
    s.push_str(&format!(
        "\x1b[K [\x1b[32m{}\x1b[0m] \x1b[1m{:3}%\x1b[0m\r\n",
        bar, pct
    ));
    s.push_str("\x1b[K\r\n");
    s.push_str("\x1b[K colors: \x1b[31mred \x1b[32mgreen \x1b[33myellow \x1b[34mblue \x1b[35mmagenta \x1b[36mcyan\x1b[0m\r\n");
    s.push_str(&format!("\x1b[K tick: {} \x1b[2m(20s cycle)\x1b[0m", tick));
    s.into_bytes()
}

pub(crate) fn demo_loop(
    tx: std::sync::mpsc::Sender<Vec<u8>>,
    keys: std::sync::mpsc::Receiver<u8>,
    cancel: Arc<AtomicBool>,
) {
    let mut tick: u64 = 0;
    let mut paused = false;
    loop {
        if cancel.load(Ordering::Relaxed) {
            break;
        }
        while let Ok(k) = keys.try_recv() {
            match k {
                b' ' => paused = !paused,
                b'r' => tick = 0,
                b'q' => cancel.store(true, Ordering::Relaxed),
                _ => {}
            }
        }
        if cancel.load(Ordering::Relaxed) {
            break;
        }
        if !paused {
            if tx.send(render_demo_frame(tick)).is_err() {
                break;
            }
            tick += 1;
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
    let _ = tx.send(b"\r\n\x1b[2mdemo session ended\x1b[0m\r\n".to_vec());
}
// What a demo-style starter hands to spawn_animation_session.
struct SpawnedDemo {
    reader: DemoReader,
    writer: DemoWriter,
    cancel: Arc<AtomicBool>,
    ctl: std::sync::mpsc::Sender<crate::state::SerialCtl>,
}

// Spawn a fresh demo animation thread; returns relay ends + the cancel flag.
fn start_demo() -> SpawnedDemo {
    let (frame_tx, frame_rx) = std::sync::mpsc::channel::<Vec<u8>>();
    let (key_tx, key_rx) = std::sync::mpsc::channel::<u8>();
    let (ctl_tx, _ctl_rx) = std::sync::mpsc::channel::<crate::state::SerialCtl>();
    let cancel = Arc::new(AtomicBool::new(false));
    std::thread::spawn({
        let cancel = cancel.clone();
        move || demo_loop(frame_tx, key_rx, cancel)
    });
    SpawnedDemo {
        reader: DemoReader::new(frame_rx),
        writer: DemoWriter { tx: key_tx },
        cancel,
        ctl: ctl_tx,
    }
}

// Shared spawn path for the in-memory animation sessions (Demo / Anime TTY):
// registers the relay with reconnect hooks that restart the animation thread.
#[cfg(debug_assertions)]
fn spawn_animation_session(
    state: tauri::State<AppState>,
    app: tauri::AppHandle,
    starter: fn() -> SpawnedDemo,
) -> Result<WsConnectResult, String> {
    let spawned = starter();

    let mut next = state.next_id.lock().map_err(|e| e.to_string())?;
    let id = format!("tab-{}", *next);
    *next += 1;
    drop(next);

    // Demo sessions are reconnectable too: 'q' -> dead-mode prompt -> Enter
    // restarts the animation.
    let hooks = {
        let serial_sessions = state.serial_sessions.clone();
        let app2 = app.clone();
        let id2 = id.clone();
        ReconnectHooks {
            notice: Box::new(crate::deadmode::disconnect_notice),
            pre_resume: Box::new(Vec::new),
            on_state: Box::new(move |alive| {
                let _ = app2.emit(
                    "session-state",
                    SessionState {
                        id: id2.clone(),
                        alive,
                    },
                );
            }),
            // Demo sessions restart on Enter only — no auto-reconnect.
            auto_retry: None,
            respawn: {
                let id3 = id.clone();
                Box::new(move || {
                    let s = starter();
                    serial_sessions.lock().map_err(|e| e.to_string())?.insert(
                        id3.clone(),
                        SerialSession {
                            cancel: s.cancel,
                            ctl: s.ctl,
                            spec: None,
                            auto_hold_restore: false,
                        },
                    );
                    Ok((
                        Box::new(s.reader) as Box<dyn Read + Send>,
                        Box::new(s.writer) as Box<dyn Write + Send>,
                    ))
                })
            },
        }
    };
    register_session(&state.hub, &id, spawned.reader, spawned.writer, Some(hooks))?;

    state
        .serial_sessions
        .lock()
        .map_err(|e| e.to_string())?
        .insert(
            id.clone(),
            SerialSession {
                cancel: spawned.cancel,
                ctl: spawned.ctl,
                spec: None,
                auto_hold_restore: false,
            },
        );

    Ok(state.ws_result(id))
}

#[cfg(debug_assertions)]
#[tauri::command]
pub fn demo_spawn(
    state: tauri::State<AppState>,
    app: tauri::AppHandle,
) -> Result<WsConnectResult, String> {
    spawn_animation_session(state, app, start_demo)
}

// ── Anime TTY (gostty port, debug builds) ─────────────────────────
// Full-screen terminal animation ported from gostty
// (https://github.com/ashish0kumar/gostty, MIT License — see NOTICE.md).
// The 235 GIF-derived frames are embedded verbatim; the renderer ports
// gostty's centering and <c> color-tag processing so the animation is
// identical to running gostty — with no external binary dependency.
// Like gostty it enters the alt screen and hides the cursor, which also
// makes it a deterministic fixture for hidden-cursor (IME) and
// full-screen-repaint (flicker) testing.

const ANIME_DATA: &str = include_str!("anime-data.json");
const ANIME_WIDTH: usize = 77; // gostty ImageWidth
const ANIME_HEIGHT: usize = 41; // gostty ImageHeight
const ANIME_FRAME_DELAY_MS: u64 = 35; // gostty MicrosPerFrame = 35000
const ANIME_HIGHLIGHT: &str = "\x1b[34m"; // gostty default highlight (blue)
const ANIME_CLEAR_AND_HOME: &str = "\x1b[2J\x1b[H";

fn anime_frames() -> &'static Vec<Vec<String>> {
    static FRAMES: std::sync::OnceLock<Vec<Vec<String>>> = std::sync::OnceLock::new();
    FRAMES.get_or_init(|| serde_json::from_str(ANIME_DATA).expect("invalid anime-data.json"))
}

// Port of gostty's processColorCodes: <c>…</c> → highlight SGR … reset.
fn anime_process_color_codes(line: &str, out: &mut String) {
    let mut rest = line;
    loop {
        let Some(start) = rest.find("<c>") else {
            out.push_str(rest);
            break;
        };
        out.push_str(&rest[..start]);
        let after = &rest[start + 3..];
        let Some(end) = after.find("</c>") else {
            out.push_str(rest); // malformed tag: emit remainder verbatim
            break;
        };
        out.push_str(ANIME_HIGHLIGHT);
        out.push_str(&after[..end]);
        out.push_str("\x1b[0m");
        rest = &after[end + 4..];
    }
}

// gostty centers on the real terminal; the size arrives over the SerialCtl
// channel (pty_resize forwarding). Until the first resize, assume 80x24.
pub(crate) fn render_anime_frame(frame_idx: usize, cols: u16, rows: u16) -> Vec<u8> {
    let frames = anime_frames();
    let lines = &frames[frame_idx % frames.len()];
    let vpad = (rows as usize).saturating_sub(ANIME_HEIGHT) / 2;
    let hpad = (cols as usize).saturating_sub(ANIME_WIDTH) / 2;
    let mut s = String::with_capacity(4096);
    s.push_str(ANIME_CLEAR_AND_HOME);
    for _ in 0..vpad {
        s.push('\n');
    }
    let padding = " ".repeat(hpad);
    for (i, line) in lines.iter().enumerate() {
        s.push_str(&padding);
        anime_process_color_codes(line, &mut s);
        if i < lines.len() - 1 {
            // NOTE: gostty emits bare "\n" and relies on the Windows console
            // (ConPTY) treating LF as CR+LF. This session feeds xterm.js
            // directly, where LF keeps the column — bare LF would make every
            // line start at the previous line's end column and wrap. Use CRLF.
            s.push_str("\r\n");
        }
    }
    s.into_bytes()
}

pub(crate) fn anime_loop(
    tx: std::sync::mpsc::Sender<Vec<u8>>,
    keys: std::sync::mpsc::Receiver<u8>,
    ctl_rx: std::sync::mpsc::Receiver<crate::state::SerialCtl>,
    cancel: Arc<AtomicBool>,
) {
    // alt screen + hide cursor (gostty preamble)
    let _ = tx.send(b"\x1b[?1049h\x1b[?25l".to_vec());
    let mut frame: usize = 0;
    let mut paused = false;
    let mut cols: u16 = 80;
    let mut rows: u16 = 24;
    loop {
        if cancel.load(Ordering::Relaxed) {
            break;
        }
        while let Ok(msg) = ctl_rx.try_recv() {
            if let crate::state::SerialCtl::SetSize(c, r) = msg {
                cols = c;
                rows = r;
            }
        }
        while let Ok(k) = keys.try_recv() {
            match k {
                b' ' => paused = !paused,
                b'r' => frame = 0,
                b'q' => cancel.store(true, Ordering::Relaxed),
                _ => {}
            }
        }
        if cancel.load(Ordering::Relaxed) {
            break;
        }
        if !paused {
            if tx.send(render_anime_frame(frame, cols, rows)).is_err() {
                break;
            }
            frame = (frame + 1) % anime_frames().len();
        }
        std::thread::sleep(std::time::Duration::from_millis(ANIME_FRAME_DELAY_MS));
    }
    // restore cursor + leave alt screen, then the relay's dead mode takes over
    let _ = tx.send(b"\x1b[?25h\x1b[?1049l\r\n\x1b[2manime session ended\x1b[0m\r\n".to_vec());
}

fn start_anime() -> SpawnedDemo {
    let (frame_tx, frame_rx) = std::sync::mpsc::channel::<Vec<u8>>();
    let (key_tx, key_rx) = std::sync::mpsc::channel::<u8>();
    let (ctl_tx, ctl_rx) = std::sync::mpsc::channel::<crate::state::SerialCtl>();
    let cancel = Arc::new(AtomicBool::new(false));
    std::thread::spawn({
        let cancel = cancel.clone();
        move || anime_loop(frame_tx, key_rx, ctl_rx, cancel)
    });
    SpawnedDemo {
        reader: DemoReader::new(frame_rx),
        writer: DemoWriter { tx: key_tx },
        cancel,
        ctl: ctl_tx,
    }
}

#[cfg(debug_assertions)]
#[tauri::command]
pub fn anime_spawn(
    state: tauri::State<AppState>,
    app: tauri::AppHandle,
) -> Result<WsConnectResult, String> {
    spawn_animation_session(state, app, start_anime)
}

// ── Mock serial ports (debug builds) ────────────────────────────────
// Virtual SerialPort implementations injected into the REAL serial pump
// (serial::start_serial_session), so loopback/newline tests exercise the
// production I/O path — including future backend newline processing.

use std::time::Duration;

pub(crate) enum MockKind {
    Loopback,
    Newlines,
}

struct MockShared {
    rx: std::sync::Mutex<std::sync::mpsc::Receiver<Vec<u8>>>,
    tx: std::sync::mpsc::Sender<Vec<u8>>,
}

// Line-ending test blocks emitted by the newlines mock. Each label shows
// the block's own line ending in escaped form plus the profile/mode that
// renders it cleanly, so the right Output-newlines choice is eyeballed.
pub(crate) const NEWLINE_BLOCKS: [&str; 4] = [
    "\x1b[36m[1] CRLF \\r\\n - keep (Normal/AT)\x1b[0m\r\nalpha\r\nbeta\r\n",
    "\x1b[36m[2] LF \\n - cr-in-lf (Log) fixes staircase\x1b[0m\nalpha\nbeta\n",
    "\x1b[36m[3] CR \\r - lf-in-cr fixes overwrite\x1b[0m\ralpha\rbeta\r",
    "\x1b[36m[4] mixed \\r\\n \\r \\n - force-crlf tidies\x1b[0m\nalpha\r\nbeta\rgamma\r\n",
];

pub(crate) struct MockSerialPort {
    kind: MockKind,
    shared: Arc<MockShared>,
    baud: u32,
}

// Mock port names injected into serial_list_ports / serial_spawn in debug builds.
pub(crate) const MOCK_LOOPBACK_NAME: &str = "MOCK-LOOP";
pub(crate) const MOCK_NEWLINES_NAME: &str = "MOCK-NL";

// Map a mock port name to a fresh virtual port (None for real hardware names).
pub(crate) fn mock_port_by_name(name: &str) -> Option<Box<dyn serialport::SerialPort>> {
    match name {
        MOCK_LOOPBACK_NAME => Some(Box::new(MockSerialPort::loopback())),
        MOCK_NEWLINES_NAME => Some(Box::new(MockSerialPort::newline_emitter())),
        _ => None,
    }
}

impl MockSerialPort {
    pub(crate) fn loopback() -> Self {
        let (tx, rx) = std::sync::mpsc::channel();
        Self {
            kind: MockKind::Loopback,
            shared: Arc::new(MockShared {
                rx: std::sync::Mutex::new(rx),
                tx,
            }),
            baud: 115200,
        }
    }

    pub(crate) fn newline_emitter() -> Self {
        let (tx, rx) = std::sync::mpsc::channel::<Vec<u8>>();
        // Background thread cycles through line-ending test blocks
        let tx2 = tx.clone();
        std::thread::spawn(move || {
            let mut i = 0;
            loop {
                if tx2
                    .send(NEWLINE_BLOCKS[i % NEWLINE_BLOCKS.len()].as_bytes().to_vec())
                    .is_err()
                {
                    break;
                }
                i += 1;
                std::thread::sleep(Duration::from_millis(2500));
            }
        });
        Self {
            kind: MockKind::Newlines,
            shared: Arc::new(MockShared {
                rx: std::sync::Mutex::new(rx),
                tx,
            }),
            baud: 115200,
        }
    }
}

impl Read for MockSerialPort {
    fn read(&mut self, out: &mut [u8]) -> std::io::Result<usize> {
        let rx = self.shared.rx.lock().unwrap();
        match rx.recv_timeout(Duration::from_millis(20)) {
            Ok(data) => {
                let n = data.len().min(out.len());
                out[..n].copy_from_slice(&data[..n]);
                Ok(n)
            }
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => Err(std::io::Error::new(
                std::io::ErrorKind::TimedOut,
                "mock timeout",
            )),
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => Ok(0),
        }
    }
}

impl Write for MockSerialPort {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        match self.kind {
            // Loopback: written bytes come straight back as reads
            MockKind::Loopback => {
                let _ = self.shared.tx.send(buf.to_vec());
            }
            // Newline emitter: input is discarded (device is talk-only)
            MockKind::Newlines => {}
        }
        Ok(buf.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

impl serialport::SerialPort for MockSerialPort {
    fn name(&self) -> Option<String> {
        Some(match self.kind {
            MockKind::Loopback => "MOCK-LOOP".into(),
            MockKind::Newlines => "MOCK-NL".into(),
        })
    }
    fn baud_rate(&self) -> serialport::Result<u32> {
        Ok(self.baud)
    }
    fn data_bits(&self) -> serialport::Result<serialport::DataBits> {
        Ok(serialport::DataBits::Eight)
    }
    fn flow_control(&self) -> serialport::Result<serialport::FlowControl> {
        Ok(serialport::FlowControl::None)
    }
    fn parity(&self) -> serialport::Result<serialport::Parity> {
        Ok(serialport::Parity::None)
    }
    fn stop_bits(&self) -> serialport::Result<serialport::StopBits> {
        Ok(serialport::StopBits::One)
    }
    fn timeout(&self) -> Duration {
        Duration::from_millis(20)
    }
    fn set_baud_rate(&mut self, baud_rate: u32) -> serialport::Result<()> {
        self.baud = baud_rate;
        // Loopback reports the baud change so the user sees it took effect
        if let MockKind::Loopback = self.kind {
            let _ = self
                .shared
                .tx
                .send(format!("\r\n[mock] baud => {}\r\n", baud_rate).into_bytes());
        }
        Ok(())
    }
    fn set_data_bits(&mut self, _: serialport::DataBits) -> serialport::Result<()> {
        Ok(())
    }
    fn set_flow_control(&mut self, _: serialport::FlowControl) -> serialport::Result<()> {
        Ok(())
    }
    fn set_parity(&mut self, _: serialport::Parity) -> serialport::Result<()> {
        Ok(())
    }
    fn set_stop_bits(&mut self, _: serialport::StopBits) -> serialport::Result<()> {
        Ok(())
    }
    fn set_timeout(&mut self, _: Duration) -> serialport::Result<()> {
        Ok(())
    }
    fn write_request_to_send(&mut self, _: bool) -> serialport::Result<()> {
        Ok(())
    }
    fn write_data_terminal_ready(&mut self, _: bool) -> serialport::Result<()> {
        Ok(())
    }
    fn read_clear_to_send(&mut self) -> serialport::Result<bool> {
        Ok(true)
    }
    fn read_data_set_ready(&mut self) -> serialport::Result<bool> {
        Ok(true)
    }
    fn read_ring_indicator(&mut self) -> serialport::Result<bool> {
        Ok(false)
    }
    fn read_carrier_detect(&mut self) -> serialport::Result<bool> {
        Ok(true)
    }
    fn bytes_to_read(&self) -> serialport::Result<u32> {
        Ok(0)
    }
    fn bytes_to_write(&self) -> serialport::Result<u32> {
        Ok(0)
    }
    fn clear(&self, _: serialport::ClearBuffer) -> serialport::Result<()> {
        Ok(())
    }
    fn try_clone(&self) -> serialport::Result<Box<dyn serialport::SerialPort>> {
        Ok(Box::new(MockSerialPort {
            kind: match self.kind {
                MockKind::Loopback => MockKind::Loopback,
                MockKind::Newlines => MockKind::Newlines,
            },
            shared: self.shared.clone(),
            baud: self.baud,
        }))
    }
    fn set_break(&self) -> serialport::Result<()> {
        Ok(())
    }
    fn clear_break(&self) -> serialport::Result<()> {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // -- anime TTY (gostty port) --

    #[test]
    fn anime_data_parses_and_matches_gostty_shape() {
        let frames = anime_frames();
        assert_eq!(frames.len(), 235, "gostty ships 235 frames");
        assert_eq!(frames[0].len(), 41, "gostty ImageHeight");
    }

    #[test]
    fn anime_color_tags_become_sgr() {
        let mut s = String::new();
        anime_process_color_codes("ab<c>xyz</c>de", &mut s);
        assert_eq!(s, "ab\x1b[34mxyz\x1b[0mde");
        let mut s2 = String::new();
        anime_process_color_codes("plain $", &mut s2);
        assert_eq!(s2, "plain $");
        let mut s3 = String::new();
        anime_process_color_codes("a<c>b", &mut s3);
        // gostty quirk: on a malformed tag it re-emits the remainder from the
        // ORIGINAL index, duplicating pre-tag bytes. Dead path for the
        // embedded data (all 17858 tags well-formed) — ported for parity.
        assert_eq!(s3, "aa<c>b");
    }

    #[test]
    fn anime_frame_is_clear_home_plus_centered_sgr_content() {
        let frame = render_anime_frame(0, 120, 45);
        let text = String::from_utf8(frame).unwrap();
        assert!(
            text.starts_with("\x1b[2J\x1b[H"),
            "frame starts with ClearAndHome"
        );
        assert!(text.contains("\x1b[34m"), "highlight color present");
        assert!(!text.contains("<c>"), "no raw color tags leak");
        assert!(text.starts_with("\x1b[2J\x1b[H\n\n"), "centered vertically");
        let content_line = text.lines().nth(2).unwrap();
        assert!(
            content_line.starts_with(&" ".repeat(21)),
            "centered horizontally"
        );
    }

    #[test]
    fn anime_frame_centering_follows_terminal_size() {
        // 120x45 → hpad (120-77)/2 = 21, vpad (45-41)/2 = 2
        // 100x43 → hpad 11, vpad 1
        // 60x20 (smaller than image) → no padding at all
        let big = String::from_utf8(render_anime_frame(0, 120, 45)).unwrap();
        let mid = String::from_utf8(render_anime_frame(0, 100, 43)).unwrap();
        let small = String::from_utf8(render_anime_frame(0, 60, 20)).unwrap();
        assert!(big.lines().nth(2).unwrap().starts_with(&" ".repeat(21)));
        assert!(mid.lines().nth(1).unwrap().starts_with(&" ".repeat(11)));
        assert!(
            small.starts_with("\x1b[2J\x1b[H"),
            "no vertical padding when shorter than the image"
        );
        let first_content = small.lines().next().unwrap_or("");
        assert!(
            !first_content.starts_with("  "),
            "no horizontal padding when narrower than the image"
        );
    }

    #[test]
    fn anime_frames_differ_across_time() {
        assert_ne!(
            render_anime_frame(0, 120, 45),
            render_anime_frame(100, 120, 45)
        );
    }

    #[test]
    fn anime_loop_quits_on_q_and_restores_terminal() {
        let (tx, rx) = std::sync::mpsc::channel::<Vec<u8>>();
        let (key_tx, key_rx) = std::sync::mpsc::channel::<u8>();
        let (_ctl_tx, ctl_rx) = std::sync::mpsc::channel::<crate::state::SerialCtl>();
        let cancel = Arc::new(AtomicBool::new(false));
        key_tx.send(b'q').unwrap();
        anime_loop(tx, key_rx, ctl_rx, cancel.clone());
        let mut all = Vec::new();
        while let Ok(chunk) = rx.try_recv() {
            all.extend(chunk);
        }
        let text = String::from_utf8_lossy(&all);
        assert!(
            text.contains("\x1b[?1049h\x1b[?25l"),
            "enters alt screen + hides cursor"
        );
        assert!(
            text.contains("\x1b[?25h\x1b[?1049l"),
            "restores cursor + leaves alt screen"
        );
        assert!(text.contains("anime session ended"));
    }

    #[test]
    fn anime_loop_applies_set_size_to_centering() {
        let (tx, rx) = std::sync::mpsc::channel::<Vec<u8>>();
        let (key_tx, key_rx) = std::sync::mpsc::channel::<u8>();
        let (ctl_tx, ctl_rx) = std::sync::mpsc::channel::<crate::state::SerialCtl>();
        let cancel = Arc::new(AtomicBool::new(false));
        ctl_tx
            .send(crate::state::SerialCtl::SetSize(120, 45))
            .unwrap();
        let handle = std::thread::spawn({
            let cancel = cancel.clone();
            move || anime_loop(tx, key_rx, ctl_rx, cancel)
        });
        std::thread::sleep(std::time::Duration::from_millis(80)); // a couple of frames
        key_tx.send(b'q').unwrap();
        handle.join().unwrap();
        let mut all = Vec::new();
        while let Ok(chunk) = rx.try_recv() {
            all.extend(chunk);
        }
        let text = String::from_utf8_lossy(&all);
        assert!(
            text.contains(&" ".repeat(21)),
            "frame centered for 120 cols after SetSize"
        );
    }

    // -- demo TTY --

    #[test]
    fn demo_frame_contains_osc94_and_ansi() {
        // tick 40 + 3*42 = 166 -> 42% progress, state 1
        let frame = String::from_utf8(render_demo_frame(40 + 3 * 42)).unwrap();
        assert!(
            frame.contains("\x1b]9;4;1;42\x07"),
            "OSC 9;4 sequence: {:?}",
            frame
        );
        assert!(frame.contains("42%"));
        assert!(frame.contains("\x1b[1;36m"), "ANSI colors present");
        assert!(frame.contains("TTerm Demo TTY"));
    }

    #[test]
    fn demo_frame_phases() {
        let phase_of = |tick: u64| {
            let f = String::from_utf8(render_demo_frame(tick)).unwrap();
            let start = f.find("\x1b]9;4;").unwrap() + 6; // skip ESC ] 9 ; 4 ;
            f[start..].chars().next().unwrap()
        };
        assert_eq!(phase_of(10), '3'); // indeterminate
        assert_eq!(phase_of(100), '1'); // normal
        assert_eq!(phase_of(350), '4'); // warning
        assert_eq!(phase_of(370), '2'); // error
        assert_eq!(phase_of(390), '0'); // hidden
    }

    #[test]
    fn demo_frame_cycles_every_400_ticks() {
        // Frames one cycle apart are identical except the absolute tick counter
        let up_to_tick = |tick: u64| {
            let f = String::from_utf8(render_demo_frame(tick)).unwrap();
            f[..f.find("tick: ").unwrap()].to_string()
        };
        assert_eq!(up_to_tick(0), up_to_tick(400));
        assert_eq!(up_to_tick(137), up_to_tick(537));
    }

    #[test]
    fn demo_reader_eof_when_channel_closed() {
        let (tx, rx) = std::sync::mpsc::channel::<Vec<u8>>();
        let mut reader = DemoReader::new(rx);
        tx.send(b"hello".to_vec()).unwrap();
        drop(tx); // closing channel -> subsequent reads EOF
        let mut buf = [0u8; 64];
        let n = reader.read(&mut buf).unwrap();
        assert_eq!(&buf[..n], b"hello");
        assert_eq!(reader.read(&mut buf).unwrap(), 0);
    }

    #[test]
    fn mock_loopback_roundtrip() {
        let mut port = MockSerialPort::loopback();
        port.write_all(b"AT+TEST\r").unwrap();
        let mut buf = [0u8; 64];
        let n = port.read(&mut buf).unwrap();
        assert_eq!(&buf[..n], b"AT+TEST\r");
    }

    #[test]
    fn mock_loopback_baud_change_is_reported() {
        use serialport::SerialPort;
        let mut port = MockSerialPort::loopback();
        port.set_baud_rate(9600).unwrap();
        assert_eq!(port.baud_rate().unwrap(), 9600);
        let mut buf = [0u8; 64];
        let n = port.read(&mut buf).unwrap();
        let msg = String::from_utf8_lossy(&buf[..n]);
        assert!(msg.contains("9600"), "{}", msg);
    }

    #[test]
    fn mock_newlines_blocks_cover_all_ending_styles() {
        assert!(NEWLINE_BLOCKS[0].contains("\r\n"));
        let b1 = NEWLINE_BLOCKS[1];
        assert!(b1.contains("\n") && !b1.contains("\r")); // LF only
        let b2 = NEWLINE_BLOCKS[2];
        assert!(b2.contains("\r") && !b2.contains("\n")); // CR only
        let b3 = NEWLINE_BLOCKS[3];
        assert!(b3.contains("\r\n") && b3.contains("\rgamma") && b3.ends_with("\n"));
        // mixed
    }

    #[test]
    fn mock_newlines_emits_first_block_immediately() {
        let mut port = MockSerialPort::newline_emitter();
        let mut buf = [0u8; 256];
        let n = port.read(&mut buf).unwrap();
        let text = String::from_utf8_lossy(&buf[..n]);
        assert!(text.contains("[1]"));
        assert!(text.contains("\r\n"));
    }
}
