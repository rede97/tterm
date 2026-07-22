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

}
