//! Demo TTY (debug builds only — entire file gated in lib.rs).
//! A mock terminal session with no child process: a thread generates animated
//! TUI frames + OSC 9;4 progress sequences; keystrokes control playback.
//! Reuses start_ws_relay via in-memory Read/Write adapters.

use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use crate::relay::start_ws_relay;
use crate::state::{AppState, SerialSession, WsConnectResult};


pub(crate) struct DemoReader {
    rx: std::sync::mpsc::Receiver<Vec<u8>>,
    cur: std::collections::VecDeque<u8>,
}

impl DemoReader {
    pub(crate) fn new(rx: std::sync::mpsc::Receiver<Vec<u8>>) -> Self {
        Self { rx, cur: std::collections::VecDeque::new() }
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
s.push_str(&format!("\x1b[K phase: \x1b[1m{}\x1b[0m {}\r\n", phase, spin));
s.push_str(&format!("\x1b[K [\x1b[32m{}\x1b[0m] \x1b[1m{:3}%\x1b[0m\r\n", bar, pct));
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
#[cfg(debug_assertions)]
#[tauri::command]
pub fn demo_spawn(state: tauri::State<AppState>) -> Result<WsConnectResult, String> {
    let (frame_tx, frame_rx) = std::sync::mpsc::channel::<Vec<u8>>();
    let (key_tx, key_rx) = std::sync::mpsc::channel::<u8>();
    let cancel = Arc::new(AtomicBool::new(false));

    std::thread::spawn({
        let cancel = cancel.clone();
        move || demo_loop(frame_tx, key_rx, cancel)
    });

    let reader = DemoReader::new(frame_rx);
    let writer = DemoWriter { tx: key_tx };
    let ws_port = start_ws_relay(reader, writer, Some(cancel.clone()))?;

    let mut next = state.next_id.lock().map_err(|e| e.to_string())?;
    let id = format!("tab-{}", *next);
    *next += 1;
    drop(next);

    state
        .serial_sessions
        .lock()
        .map_err(|e| e.to_string())?
        .insert(id.clone(), SerialSession { cancel, ctl: std::sync::mpsc::channel::<crate::state::SerialCtl>().0, spec: None });

    Ok(WsConnectResult { id, port: ws_port })
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

// Line-ending test blocks emitted by the newlines mock.
pub(crate) const NEWLINE_BLOCKS: [&str; 4] = [
    "\x1b[36m[1] CRLF lines:\x1b[0m\r\nalpha\r\nbeta\r\n",
    "\x1b[36m[2] LF only (staircase when raw):\x1b[0m\nalpha\nbeta\n",
    "\x1b[36m[3] CR only (overwrite when raw):\x1b[0m\ralpha\rbeta\r",
    "\x1b[36m[4] mixed:\x1b[0m\nalpha\r\nbeta\rgamma\r\n",
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
        Self { kind: MockKind::Loopback, shared: Arc::new(MockShared { rx: std::sync::Mutex::new(rx), tx }), baud: 115200 }
    }

    pub(crate) fn newline_emitter() -> Self {
        let (tx, rx) = std::sync::mpsc::channel::<Vec<u8>>();
        // Background thread cycles through line-ending test blocks
        let tx2 = tx.clone();
        std::thread::spawn(move || {
            let mut i = 0;
            loop {
                if tx2.send(NEWLINE_BLOCKS[i % NEWLINE_BLOCKS.len()].as_bytes().to_vec()).is_err() {
                    break;
                }
                i += 1;
                std::thread::sleep(Duration::from_millis(2500));
            }
        });
        Self { kind: MockKind::Newlines, shared: Arc::new(MockShared { rx: std::sync::Mutex::new(rx), tx }), baud: 115200 }
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
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                Err(std::io::Error::new(std::io::ErrorKind::TimedOut, "mock timeout"))
            }
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
        Some(match self.kind { MockKind::Loopback => "MOCK-LOOP".into(), MockKind::Newlines => "MOCK-NL".into() })
    }
    fn baud_rate(&self) -> serialport::Result<u32> { Ok(self.baud) }
    fn data_bits(&self) -> serialport::Result<serialport::DataBits> { Ok(serialport::DataBits::Eight) }
    fn flow_control(&self) -> serialport::Result<serialport::FlowControl> { Ok(serialport::FlowControl::None) }
    fn parity(&self) -> serialport::Result<serialport::Parity> { Ok(serialport::Parity::None) }
    fn stop_bits(&self) -> serialport::Result<serialport::StopBits> { Ok(serialport::StopBits::One) }
    fn timeout(&self) -> Duration { Duration::from_millis(20) }
    fn set_baud_rate(&mut self, baud_rate: u32) -> serialport::Result<()> {
        self.baud = baud_rate;
        // Loopback reports the baud change so the user sees it took effect
        if let MockKind::Loopback = self.kind {
            let _ = self.shared.tx.send(format!("\r\n[mock] baud => {}\r\n", baud_rate).into_bytes());
        }
        Ok(())
    }
    fn set_data_bits(&mut self, _: serialport::DataBits) -> serialport::Result<()> { Ok(()) }
    fn set_flow_control(&mut self, _: serialport::FlowControl) -> serialport::Result<()> { Ok(()) }
    fn set_parity(&mut self, _: serialport::Parity) -> serialport::Result<()> { Ok(()) }
    fn set_stop_bits(&mut self, _: serialport::StopBits) -> serialport::Result<()> { Ok(()) }
    fn set_timeout(&mut self, _: Duration) -> serialport::Result<()> { Ok(()) }
    fn write_request_to_send(&mut self, _: bool) -> serialport::Result<()> { Ok(()) }
    fn write_data_terminal_ready(&mut self, _: bool) -> serialport::Result<()> { Ok(()) }
    fn read_clear_to_send(&mut self) -> serialport::Result<bool> { Ok(true) }
    fn read_data_set_ready(&mut self) -> serialport::Result<bool> { Ok(true) }
    fn read_ring_indicator(&mut self) -> serialport::Result<bool> { Ok(false) }
    fn read_carrier_detect(&mut self) -> serialport::Result<bool> { Ok(true) }
    fn bytes_to_read(&self) -> serialport::Result<u32> { Ok(0) }
    fn bytes_to_write(&self) -> serialport::Result<u32> { Ok(0) }
    fn clear(&self, _: serialport::ClearBuffer) -> serialport::Result<()> { Ok(()) }
    fn try_clone(&self) -> serialport::Result<Box<dyn serialport::SerialPort>> {
        Ok(Box::new(MockSerialPort { kind: match self.kind { MockKind::Loopback => MockKind::Loopback, MockKind::Newlines => MockKind::Newlines }, shared: self.shared.clone(), baud: self.baud }))
    }
    fn set_break(&self) -> serialport::Result<()> { Ok(()) }
    fn clear_break(&self) -> serialport::Result<()> { Ok(()) }
}

#[cfg(test)]
mod tests {
    use super::*;

    // -- demo TTY --


    #[test]
    fn demo_frame_contains_osc94_and_ansi() {
        // tick 40 + 3*42 = 166 -> 42% progress, state 1
        let frame = String::from_utf8(render_demo_frame(40 + 3 * 42)).unwrap();
        assert!(frame.contains("\x1b]9;4;1;42\x07"), "OSC 9;4 sequence: {:?}", frame);
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
        assert_eq!(phase_of(10), '3');   // indeterminate
        assert_eq!(phase_of(100), '1');  // normal
        assert_eq!(phase_of(350), '4');  // warning
        assert_eq!(phase_of(370), '2');  // error
        assert_eq!(phase_of(390), '0');  // hidden
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
        assert!(b1.contains("\n") && !b1.contains("\r"));  // LF only
        let b2 = NEWLINE_BLOCKS[2];
        assert!(b2.contains("\r") && !b2.contains("\n"));  // CR only
        let b3 = NEWLINE_BLOCKS[3];
        assert!(b3.contains("\r\n") && b3.contains("\rgamma") && b3.ends_with("\n")); // mixed
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
