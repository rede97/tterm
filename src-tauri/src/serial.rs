use serde::Serialize;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{Emitter, Manager};

use crate::newline::{NewlineFilter, NewlineMode};
use crate::relay::{register_session, ReconnectHooks};
use crate::state::{AppState, SerialCtl, SerialSession, SessionState, SpawnSpec, WsConnectResult};

#[derive(Clone, Serialize)]
pub struct SerialPortInfo {
    name: String,
    driver: String,
    manufacturer: String,
    product: String,
    vid: String,
    pid: String,
}

#[tauri::command]
pub fn serial_list_ports() -> Vec<SerialPortInfo> {
    // `mut` is only used by the debug-only mock-port injection below; the
    // attr keeps release builds warning-free.
    #[cfg_attr(not(debug_assertions), allow(unused_mut))]
    let mut result: Vec<SerialPortInfo> = serial_enumerator::get_serial_list()
        .into_iter()
        .map(|p| {
            let (vid, pid) = p.usb_info.map_or((String::new(), String::new()), |u| (u.vid, u.pid));
            SerialPortInfo {
                name: p.name,
                driver: p.driver.unwrap_or_default(),
                manufacturer: p.vendor.unwrap_or_default(),
                product: p.product.unwrap_or_default(),
                vid,
                pid,
            }
        })
        .collect();

    // Debug builds: inject virtual mock ports so the entire serial UX
    // (menu, session, params memory, settings) is testable without hardware.
    #[cfg(debug_assertions)]
    {
        result.push(SerialPortInfo {
            name: crate::demo::MOCK_LOOPBACK_NAME.into(),
            driver: "tterm-mock".into(),
            manufacturer: "TTerm".into(),
            product: "Mock Loopback (echo)".into(),
            vid: String::new(),
            pid: String::new(),
        });
        result.push(SerialPortInfo {
            name: crate::demo::MOCK_NEWLINES_NAME.into(),
            driver: "tterm-mock".into(),
            manufacturer: "TTerm".into(),
            product: "Mock Newline Patterns".into(),
            vid: String::new(),
            pid: String::new(),
        });
    }
    result
}
pub(crate) fn map_data_bits(bits: u8) -> Result<serialport::DataBits, String> {
    match bits {
        5 => Ok(serialport::DataBits::Five),
        6 => Ok(serialport::DataBits::Six),
        7 => Ok(serialport::DataBits::Seven),
        8 => Ok(serialport::DataBits::Eight),
        _ => Err(format!("Invalid data bits: {} (expected 5-8)", bits)),
    }
}

pub(crate) fn map_parity(parity: &str) -> Result<serialport::Parity, String> {
    match parity.to_ascii_lowercase().as_str() {
        "none" => Ok(serialport::Parity::None),
        "odd" => Ok(serialport::Parity::Odd),
        "even" => Ok(serialport::Parity::Even),
        _ => Err(format!("Invalid parity: {} (expected none|odd|even)", parity)),
    }
}

pub(crate) fn map_stop_bits(bits: u8) -> Result<serialport::StopBits, String> {
    match bits {
        1 => Ok(serialport::StopBits::One),
        2 => Ok(serialport::StopBits::Two),
        _ => Err(format!("Invalid stop bits: {} (expected 1|2)", bits)),
    }
}

pub(crate) fn map_flow_control(flow: &str) -> Result<serialport::FlowControl, String> {
    match flow.to_ascii_lowercase().as_str() {
        "none" => Ok(serialport::FlowControl::None),
        "software" | "xonxoff" => Ok(serialport::FlowControl::Software),
        "hardware" | "rtscts" => Ok(serialport::FlowControl::Hardware),
        _ => Err(format!("Invalid flow control: {} (expected none|software|hardware)", flow)),
    }
}

// Map low-level open errors to actionable messages.
pub(crate) fn serial_open_error(port_name: &str, err: &serialport::Error) -> String {
    let msg = err.to_string();
    let lower = msg.to_lowercase();
    if lower.contains("access") || lower.contains("denied") || lower.contains("busy") || lower.contains("being used") {
        format!("{} is busy — opened by another application", port_name)
    } else if lower.contains("not found") || lower.contains("cannot find") || lower.contains("does not exist") {
        format!("{} not found — device may have been unplugged", port_name)
    } else {
        format!("Failed to open {}: {}", port_name, msg)
    }
}

fn open_serial(
    port_name: &str, baud_rate: u32, data_bits: u8, parity: &str, stop_bits: u8, flow_control: &str,
) -> Result<Box<dyn serialport::SerialPort>, String> {
    let mut port = serialport::new(port_name, baud_rate)
        .data_bits(map_data_bits(data_bits)?)
        .parity(map_parity(parity)?)
        .stop_bits(map_stop_bits(stop_bits)?)
        .flow_control(map_flow_control(flow_control)?)
        // Short read timeout: the I/O pump polls writes and cancel each cycle.
        // 20ms keeps keystroke echo latency imperceptible.
        .timeout(std::time::Duration::from_millis(20))
        .open()
        .map_err(|e| serial_open_error(port_name, &e))?;
    // Assert DTR and RTS like PuTTY/node-serialport do. Many CDC-ACM devices
    // (debug probes, Arduino-class boards) gate TX on these lines; FT232-style
    // adapters don't care either way.
    let _ = port.write_data_terminal_ready(true);
    let _ = port.write_request_to_send(true);
    Ok(port)
}

// Read adapter: device output channel -> relay read loop.
struct SerialIoReader {
    rx: std::sync::mpsc::Receiver<Vec<u8>>,
    cur: std::collections::VecDeque<u8>,
}

impl Read for SerialIoReader {
    fn read(&mut self, out: &mut [u8]) -> std::io::Result<usize> {
        while self.cur.is_empty() {
            match self.rx.recv() {
                Ok(data) => self.cur.extend(data),
                Err(_) => return Ok(0), // I/O pump exited -> EOF
            }
        }
        let n = self.cur.len().min(out.len());
        for slot in out.iter_mut().take(n) {
            *slot = self.cur.pop_front().unwrap();
        }
        Ok(n)
    }
}

// Write adapter: relay write path -> device input channel.
struct SerialIoWriter {
    tx: std::sync::mpsc::Sender<Vec<u8>>,
}

impl Write for SerialIoWriter {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.tx
            .send(buf.to_vec())
            .map_err(|_| std::io::Error::new(std::io::ErrorKind::BrokenPipe, "serial I/O pump gone"))?;
        Ok(buf.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

// Single thread exclusively owns the serial port. Windows synchronous handles
// serialize ReadFile/WriteFile on the same file object, so the previous
// try_clone design blocked keystroke writes behind the pending read (up to
// 100ms). This pump avoids concurrent handle I/O entirely:
// drain pending writes first, then read with a short timeout.
pub(crate) fn serial_io_loop(
    mut port: Box<dyn serialport::SerialPort>,
    out: std::sync::mpsc::Sender<Vec<u8>>,
    input: std::sync::mpsc::Receiver<Vec<u8>>,
    ctl: std::sync::mpsc::Receiver<SerialCtl>,
    cancel: Arc<AtomicBool>,
    mut newline_filter: NewlineFilter,
) {
    let mut buf = [0u8; 16384];
    'outer: loop {
        if cancel.load(Ordering::Relaxed) {
            break;
        }
        // 0. Apply pending control messages (e.g. live baud / newline switch)
        while let Ok(msg) = ctl.try_recv() {
            match msg {
                SerialCtl::SetBaud(baud) => {
                    let _ = port.set_baud_rate(baud);
                }
                SerialCtl::SetOutputNewline(mode) => {
                    newline_filter.set_mode(mode);
                }
            }
        }
        // 1. Drain all pending writes immediately (keystrokes -> device)
        loop {
            match input.try_recv() {
                Ok(data) => {
                    if port.write_all(&data).is_err() {
                        break 'outer;
                    }
                }
                Err(std::sync::mpsc::TryRecvError::Empty) => break,
                Err(std::sync::mpsc::TryRecvError::Disconnected) => break 'outer,
            }
        }
        let _ = port.flush();
        // 2. Read whatever the device sent (<=20ms block), then apply the
        // output newline filter before forwarding.
        match port.read(&mut buf) {
            Ok(0) => {}
            Ok(n) => {
                let mut processed = Vec::with_capacity(n + 16);
                newline_filter.process(&buf[..n], &mut processed);
                if processed.is_empty() {
                    continue;
                }
                if out.send(processed).is_err() {
                    break;
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::TimedOut => {}
            Err(_) => break,
        }
    }
}

// Open a serial port and start the I/O pump + WS relay for session `id`.
// Shared by serial_spawn (new tab) and the dead-mode respawn hooks.
// Parameters mirror serial_spawn's invoke args 1:1.
#[allow(clippy::too_many_arguments)]
pub(crate) fn spawn_serial_session(
    state: &AppState,
    app: &tauri::AppHandle,
    id: String,
    port_name: &str,
    baud_rate: u32,
    data_bits: u8,
    parity: &str,
    stop_bits: u8,
    flow_control: &str,
    output_newline: &str,
) -> Result<(), String> {
    let port = open_serial(port_name, baud_rate, data_bits, parity, stop_bits, flow_control)?;
    let spec = SpawnSpec::Serial {
        port_name: port_name.to_string(),
        baud_rate,
        data_bits,
        parity: parity.to_string(),
        stop_bits,
        flow_control: flow_control.to_string(),
        output_newline: output_newline.to_string(),
    };
    start_serial_session(state, app, id, port, Some(spec))
}

// Start the I/O pump thread for an open port; returns the relay-facing
// reader/writer plus the pump's cancel flag and control channel.
fn start_pump(
    port: Box<dyn serialport::SerialPort>,
    nl_mode: NewlineMode,
) -> (SerialIoReader, SerialIoWriter, Arc<AtomicBool>, std::sync::mpsc::Sender<SerialCtl>) {
    let cancel = Arc::new(AtomicBool::new(false));
    let (out_tx, out_rx) = std::sync::mpsc::channel::<Vec<u8>>();
    let (in_tx, in_rx) = std::sync::mpsc::channel::<Vec<u8>>();
    let (ctl_tx, ctl_rx) = std::sync::mpsc::channel::<SerialCtl>();
    std::thread::spawn({
        let cancel = cancel.clone();
        move || serial_io_loop(port, out_tx, in_rx, ctl_rx, cancel, NewlineFilter::new(nl_mode))
    });
    (
        SerialIoReader { rx: out_rx, cur: std::collections::VecDeque::new() },
        SerialIoWriter { tx: in_tx },
        cancel,
        ctl_tx,
    )
}

// Reconnect hooks for serial sessions: the relay calls `respawn` when the
// user presses Enter at the in-band disconnect prompt (e.g. after unplug).
// Runs on a blocking relay thread.
fn serial_hooks(app: tauri::AppHandle, id: String, spec: SpawnSpec) -> ReconnectHooks {
    let serial_sessions = app.state::<AppState>().serial_sessions.clone();
    ReconnectHooks {
        notice: Box::new(crate::deadmode::disconnect_notice),
        // Serial devices emit no startup frame — nothing to preserve against.
        pre_resume: Box::new(Vec::new),
        on_state: {
            let id = id.clone();
            Box::new(move |alive| {
                let _ = app.emit("session-state", SessionState { id: id.clone(), alive });
            })
        },
        respawn: Box::new(move || {
            let SpawnSpec::Serial {
                port_name, baud_rate, data_bits, parity, stop_bits, flow_control, output_newline,
            } = &spec
            else {
                return Err("not a serial session".into());
            };
            let nl_mode = NewlineMode::from_str(output_newline).unwrap_or(NewlineMode::Keep);
            // Debug builds: mock port names get a virtual port.
            #[cfg(debug_assertions)]
            let mock = crate::demo::mock_port_by_name(port_name);
            #[cfg(not(debug_assertions))]
            let mock: Option<Box<dyn serialport::SerialPort>> = None;
            let port = match mock {
                Some(p) => p,
                None => open_serial(port_name, *baud_rate, *data_bits, parity, *stop_bits, flow_control)?,
            };
            let (reader, writer, cancel, ctl) = start_pump(port, nl_mode);
            serial_sessions
                .lock()
                .map_err(|e| e.to_string())?
                .insert(id.clone(), SerialSession { cancel, ctl, spec: Some(spec.clone()) });
            Ok((
                Box::new(reader) as Box<dyn Read + Send>,
                Box::new(writer) as Box<dyn Write + Send>,
            ))
        }),
    }
}

// Start pump + relay for an already-open serial port (real or mock).
pub(crate) fn start_serial_session(
    state: &AppState,
    app: &tauri::AppHandle,
    id: String,
    port: Box<dyn serialport::SerialPort>,
    spec: Option<SpawnSpec>,
) -> Result<(), String> {
    let nl_mode = spec
        .as_ref()
        .and_then(|s| match s {
            SpawnSpec::Serial { output_newline, .. } => NewlineMode::from_str(output_newline).ok(),
            _ => None,
        })
        .unwrap_or(NewlineMode::Keep);
    let (reader, writer, cancel, ctl_tx) = start_pump(port, nl_mode);
    let hooks = spec.clone().map(|s| serial_hooks(app.clone(), id.clone(), s));
    register_session(&state.hub, &id, reader, writer, hooks)?;

    state
        .serial_sessions
        .lock()
        .map_err(|e| e.to_string())?
        .insert(id, SerialSession { cancel, ctl: ctl_tx, spec });

    Ok(())
}

// Tauri commands map invoke() args 1:1; grouping would churn the JS side.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub fn serial_spawn(
    state: tauri::State<AppState>,
    app: tauri::AppHandle,
    port_name: String,
    baud_rate: u32,
    data_bits: u8,
    parity: String,
    stop_bits: u8,
    flow_control: String,
    output_newline: Option<String>,
) -> Result<WsConnectResult, String> {
    let mut next = state.next_id.lock().map_err(|e| e.to_string())?;
    let id = format!("tab-{}", *next);
    *next += 1;
    drop(next);

    let nl = output_newline.as_deref().unwrap_or("keep");
    NewlineMode::from_str(nl)?; // validate early

    // Debug builds: mock port names get a virtual port instead of a real open
    #[cfg(debug_assertions)]
    if let Some(mock) = crate::demo::mock_port_by_name(&port_name) {
        let spec = SpawnSpec::Serial {
            port_name: port_name.clone(),
            baud_rate,
            data_bits,
            parity: parity.clone(),
            stop_bits,
            flow_control: flow_control.clone(),
            output_newline: nl.to_string(),
        };
        start_serial_session(&state, &app, id.clone(), mock, Some(spec))?;
        return Ok(state.ws_result(id));
    }

    spawn_serial_session(
        &state, &app, id.clone(), &port_name, baud_rate, data_bits, &parity, stop_bits, &flow_control, nl,
    )?;

    Ok(state.ws_result(id))
}

#[tauri::command]
pub fn serial_set_baud(state: tauri::State<AppState>, id: &str, baud_rate: u32) -> Result<(), String> {
    let sessions = state.serial_sessions.lock().map_err(|e| e.to_string())?;
    let session = sessions
        .get(id)
        .ok_or_else(|| format!("No serial session: {}", id))?;
    session
        .ctl
        .send(SerialCtl::SetBaud(baud_rate))
        .map_err(|e| format!("Serial session closed: {}", e))
}

#[tauri::command]
pub fn serial_set_output_newline(state: tauri::State<AppState>, id: &str, mode: &str) -> Result<(), String> {
    let mode = NewlineMode::from_str(mode)?;
    let mut sessions = state.serial_sessions.lock().map_err(|e| e.to_string())?;
    let session = sessions
        .get_mut(id)
        .ok_or_else(|| format!("No serial session: {}", id))?;
    // Keep the spec in sync so reconnect preserves the current mode
    if let Some(SpawnSpec::Serial { output_newline, .. }) = &mut session.spec {
        *output_newline = mode.as_str().to_string();
    }
    session
        .ctl
        .send(SerialCtl::SetOutputNewline(mode))
        .map_err(|e| format!("Serial session closed: {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;

    // -- serial parameter mapping --

    #[test]
    fn serial_data_bits_valid_range() {
        assert!(matches!(map_data_bits(5).unwrap(), serialport::DataBits::Five));
        assert!(matches!(map_data_bits(8).unwrap(), serialport::DataBits::Eight));
    }

    #[test]
    fn serial_data_bits_rejects_invalid() {
        assert!(map_data_bits(4).is_err());
        assert!(map_data_bits(9).is_err());
    }

    #[test]
    fn serial_parity_case_insensitive() {
        assert!(matches!(map_parity("none").unwrap(), serialport::Parity::None));
        assert!(matches!(map_parity("Odd").unwrap(), serialport::Parity::Odd));
        assert!(matches!(map_parity("EVEN").unwrap(), serialport::Parity::Even));
        assert!(map_parity("mark").is_err());
    }

    #[test]
    fn serial_stop_bits() {
        assert!(matches!(map_stop_bits(1).unwrap(), serialport::StopBits::One));
        assert!(matches!(map_stop_bits(2).unwrap(), serialport::StopBits::Two));
        assert!(map_stop_bits(3).is_err());
    }

    #[test]
    fn serial_flow_control_aliases() {
        assert!(matches!(map_flow_control("none").unwrap(), serialport::FlowControl::None));
        assert!(matches!(map_flow_control("xonxoff").unwrap(), serialport::FlowControl::Software));
        assert!(matches!(map_flow_control("rtscts").unwrap(), serialport::FlowControl::Hardware));
        assert!(map_flow_control("magic").is_err());
    }

    #[test]
    fn open_serial_invalid_port_returns_err_not_panic() {
        // Smoke test: nonexistent port must fail gracefully.
        // COM254 is essentially never present on real systems.
        let result = open_serial("\\\\.\\COM254", 115200, 8, "none", 1, "none");
        assert!(result.is_err());
        let msg = result.err().unwrap();
        assert!(msg.contains("COM254"), "error should name the port: {}", msg);
    }

    #[test]
    fn open_serial_invalid_params_rejected_before_open() {
        let result = open_serial("\\\\.\\COM254", 115200, 9, "none", 1, "none");
        assert!(result.err().unwrap().contains("data bits"));
    }

    // -- serial open error mapping --

    #[test]
    fn busy_error_mentions_occupation() {
        let e = serialport::Error::new(
            serialport::ErrorKind::Io(std::io::ErrorKind::PermissionDenied),
            "Access is denied. (os error 5)",
        );
        let msg = serial_open_error("COM3", &e);
        assert!(msg.contains("COM3"));
        assert!(msg.contains("busy"));
    }

    #[test]
    fn missing_device_error_mentions_unplugged() {
        let e = serialport::Error::new(
            serialport::ErrorKind::NoDevice,
            "The system cannot find the file specified.",
        );
        let msg = serial_open_error("COM7", &e);
        assert!(msg.contains("COM7"));
        assert!(msg.contains("not found"));
    }

    #[test]
    fn unknown_error_falls_through_with_detail() {
        let e = serialport::Error::new(serialport::ErrorKind::Unknown, "something weird");
        let msg = serial_open_error("COM3", &e);
        assert!(msg.contains("Failed to open COM3"));
        assert!(msg.contains("something weird"));
    }

    // -- serial I/O pump adapters --

    #[test]
    fn serial_io_writer_forwards_to_channel() {
        let (tx, rx) = std::sync::mpsc::channel::<Vec<u8>>();
        let mut writer = SerialIoWriter { tx };
        writer.write_all(b"AT+CMD\r\n").unwrap();
        writer.flush().unwrap();
        assert_eq!(rx.try_recv().unwrap(), b"AT+CMD\r\n".to_vec());
    }

    #[test]
    fn serial_io_writer_errors_when_pump_gone() {
        let (tx, rx) = std::sync::mpsc::channel::<Vec<u8>>();
        drop(rx);
        let mut writer = SerialIoWriter { tx };
        assert_eq!(writer.write(b"x").unwrap_err().kind(), std::io::ErrorKind::BrokenPipe);
    }

    #[test]
    fn serial_io_reader_eof_when_pump_gone() {
        let (tx, rx) = std::sync::mpsc::channel::<Vec<u8>>();
        let mut reader = SerialIoReader { rx, cur: std::collections::VecDeque::new() };
        tx.send(b"device-data".to_vec()).unwrap();
        drop(tx);
        let mut buf = [0u8; 64];
        let n = reader.read(&mut buf).unwrap();
        assert_eq!(&buf[..n], b"device-data");
        assert_eq!(reader.read(&mut buf).unwrap(), 0);
    }
}
