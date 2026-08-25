use serde::Serialize;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
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
            let (vid, pid) = p
                .usb_info
                .map_or((String::new(), String::new()), |u| (u.vid, u.pid));
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
        _ => Err(format!(
            "Invalid parity: {} (expected none|odd|even)",
            parity
        )),
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
        _ => Err(format!(
            "Invalid flow control: {} (expected none|software|hardware)",
            flow
        )),
    }
}

// Map low-level open errors to actionable messages.
pub(crate) fn serial_open_error(port_name: &str, err: &serialport::Error) -> String {
    let msg = err.to_string();
    let lower = msg.to_lowercase();
    if lower.contains("access")
        || lower.contains("denied")
        || lower.contains("busy")
        || lower.contains("being used")
    {
        format!("{} is busy — opened by another application", port_name)
    } else if lower.contains("not found")
        || lower.contains("cannot find")
        || lower.contains("does not exist")
    {
        format!("{} not found — device may have been unplugged", port_name)
    } else {
        format!("Failed to open {}: {}", port_name, msg)
    }
}

fn open_serial(
    port_name: &str,
    baud_rate: u32,
    data_bits: u8,
    parity: &str,
    stop_bits: u8,
    flow_control: &str,
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
    // Assert DTR at open like PuTTY / Tabby / pyserial: CDC-ACM devices
    // (Pico/TinyUSB, debug probes, Arduino-class) gate traffic on DTR.
    // RTS is left alone (stays deasserted under FlowControl::None).
    //
    // ESP32-C3/S3 USB-Serial/JTAG (TRM CDC-ACM table): only RTS=1 AND
    // DTR=0 resets the chip (rst:0x15). That includes a DTR falling edge
    // while RTS is asserted. RTS=1 with DTR=1 is idle; DTR edges with
    // RTS=0 only set/clear the download-mode flag. Open therefore must
    // not pass through (RTS=1, DTR=0) — raising DTR first, never RTS, is
    // enough. Live DCB writes that drop DTR go through
    // release_rts_before_dcb_write so the same pair cannot appear later.
    let _ = port.write_data_terminal_ready(true);
    Ok(port)
}

fn is_hardware_flow(flow: &str) -> bool {
    matches!(
        map_flow_control(flow).ok(),
        Some(serialport::FlowControl::Hardware)
    )
}

// Windows SetCommState reapplies fDtrControl=Disable and drops DTR.
// USB-Serial/JTAG resets on RTS=1 + DTR=0, so drop RTS first: the DTR
// falling edge then happens at RTS=0 (clear download flag, no reset).
fn release_rts_before_dcb_write(
    port: &mut dyn serialport::SerialPort,
    rts: bool,
    hardware_flow: bool,
) {
    if rts || hardware_flow {
        let _ = port.write_request_to_send(false);
    }
}

// Restore lines after a DCB write. DTR first, then RTS: (0,0)→(0,1)→(1,1)
// never passes through (1,0).
fn restore_driven_lines(
    port: &mut dyn serialport::SerialPort,
    rts: bool,
    dtr: bool,
    hardware_flow: bool,
) {
    let _ = port.write_data_terminal_ready(dtr);
    if !hardware_flow {
        let _ = port.write_request_to_send(rts);
    }
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

// BrokenPipe message SerialIoWriter reports once the I/O pump thread has
// exited. serial_reconnect matches on it to detect "dead-mode Enter watcher
// not installed yet" (the write hit the dead session's orphaned writer).
const PUMP_GONE: &str = "serial I/O pump gone";
// Cap on deferred (not yet device-accepted) write bytes per session.
const MAX_PENDING_WRITE: usize = 1024 * 1024;

// Write adapter: relay write path -> device input channel.
struct SerialIoWriter {
    tx: std::sync::mpsc::Sender<Vec<u8>>,
}

impl Write for SerialIoWriter {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.tx
            .send(buf.to_vec())
            .map_err(|_| std::io::Error::new(std::io::ErrorKind::BrokenPipe, PUMP_GONE))?;
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
//
// A write TIMEOUT is not fatal: USB CDC devices whose firmware never reads
// (and CTS-held hardware flow control) exert backpressure until the driver
// buffer drains, surfacing as ERROR_SEM_TIMEOUT once the 20ms write timeout
// lapses. Such bytes are deferred to `pending` and retried every cycle —
// only other write errors end the session.
pub(crate) fn serial_io_loop(
    mut port: Box<dyn serialport::SerialPort>,
    out: std::sync::mpsc::Sender<Vec<u8>>,
    input: std::sync::mpsc::Receiver<Vec<u8>>,
    ctl: std::sync::mpsc::Receiver<SerialCtl>,
    cancel: Arc<AtomicBool>,
    mut newline_filter: NewlineFilter,
    mut hardware_flow: bool,
) {
    let mut buf = [0u8; 16384];
    // Write-behind buffer for bytes the device has not accepted yet.
    let mut pending: std::collections::VecDeque<u8> = std::collections::VecDeque::new();
    // DTR is asserted at open, RTS is not. USB-Serial/JTAG resets only on
    // RTS=1 with DTR=0; live DCB writes drop RTS before DTR can fall.
    let mut rts = false;
    let mut dtr = true;
    'outer: loop {
        if cancel.load(Ordering::Relaxed) {
            break;
        }
        // 0. Apply pending control messages (e.g. live baud / newline switch)
        while let Ok(msg) = ctl.try_recv() {
            match msg {
                SerialCtl::SetBaud(baud) => {
                    release_rts_before_dcb_write(&mut *port, rts, hardware_flow);
                    let _ = port.set_baud_rate(baud);
                    restore_driven_lines(&mut *port, rts, dtr, hardware_flow);
                }
                SerialCtl::SetOutputNewline(mode) => {
                    newline_filter.set_mode(mode);
                }
                SerialCtl::SetRts(on) => {
                    // Hardware RTS/CTS: the driver owns RTS (RTS_CONTROL_ENABLE
                    // holds it asserted). Software SETRTS would fight handshake
                    // and, with DTR falling, reset ESP32 USB-Serial/JTAG.
                    if !hardware_flow && port.write_request_to_send(on).is_ok() {
                        rts = on;
                    }
                }
                SerialCtl::SetDtr(on) => {
                    if port.write_data_terminal_ready(on).is_ok() {
                        dtr = on;
                    }
                }
                SerialCtl::SetFlowControl(flow) => {
                    if let Ok(mode) = map_flow_control(&flow) {
                        release_rts_before_dcb_write(&mut *port, rts, hardware_flow);
                        hardware_flow = mode == serialport::FlowControl::Hardware;
                        let _ = port.set_flow_control(mode);
                        restore_driven_lines(&mut *port, rts, dtr, hardware_flow);
                    }
                }
                SerialCtl::QueryLines(reply) => {
                    let cts = port.read_clear_to_send();
                    let dsr = port.read_data_set_ready();
                    // A driver that can't report modem lines errors here —
                    // the panel greys the flow-control block.
                    let supported = cts.is_ok() && dsr.is_ok();
                    let _ = reply.send(crate::state::SerialLineState {
                        // Under hardware flow the driver asserts RTS; our
                        // tracker is the last software-driven value (used
                        // when leaving hardware mode).
                        rts: if hardware_flow { true } else { rts },
                        cts: cts.unwrap_or(false),
                        dtr,
                        dsr: dsr.unwrap_or(false),
                        supported,
                    });
                }
                SerialCtl::SetSize(..) => {} // meaningless for real serial ports
            }
        }
        // 1. Drain all pending writes immediately (keystrokes -> device):
        // deferred bytes first, then new input. Write timeouts defer into
        // `pending` (retried next cycle); other write errors are fatal.
        while !pending.is_empty() {
            match port.write(pending.as_slices().0) {
                Ok(0) => break, // no progress — retry after the read poll
                Ok(n) => {
                    pending.drain(..n);
                }
                Err(e) if e.kind() == std::io::ErrorKind::TimedOut => break,
                Err(_) => break 'outer,
            }
        }
        loop {
            match input.try_recv() {
                Ok(data) => {
                    if pending.is_empty() {
                        match port.write(&data) {
                            Ok(n) => pending.extend(data[n..].iter().copied()),
                            Err(e) if e.kind() == std::io::ErrorKind::TimedOut => {
                                pending.extend(data.iter().copied());
                            }
                            Err(_) => break 'outer,
                        }
                    } else {
                        pending.extend(data.iter().copied());
                    }
                    // A device that NEVER accepts data must not grow this
                    // without bound; past the cap the session is truly dead.
                    if pending.len() > MAX_PENDING_WRITE {
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
    let port = open_serial(
        port_name,
        baud_rate,
        data_bits,
        parity,
        stop_bits,
        flow_control,
    )?;
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
    hardware_flow: bool,
) -> (
    SerialIoReader,
    SerialIoWriter,
    Arc<AtomicBool>,
    std::sync::mpsc::Sender<SerialCtl>,
) {
    let cancel = Arc::new(AtomicBool::new(false));
    let (out_tx, out_rx) = std::sync::mpsc::channel::<Vec<u8>>();
    let (in_tx, in_rx) = std::sync::mpsc::channel::<Vec<u8>>();
    let (ctl_tx, ctl_rx) = std::sync::mpsc::channel::<SerialCtl>();
    std::thread::spawn({
        let cancel = cancel.clone();
        move || {
            serial_io_loop(
                port,
                out_tx,
                in_rx,
                ctl_rx,
                cancel,
                NewlineFilter::new(nl_mode),
                hardware_flow,
            )
        }
    });
    (
        SerialIoReader {
            rx: out_rx,
            cur: std::collections::VecDeque::new(),
        },
        SerialIoWriter { tx: in_tx },
        cancel,
        ctl_tx,
    )
}

// Reconnect hooks for serial sessions: the relay calls `respawn` when the
// user presses Enter at the in-band disconnect prompt (e.g. after unplug).
// Runs on a blocking relay thread.
fn serial_hooks(
    app: tauri::AppHandle,
    id: String,
    spec: SpawnSpec,
    auto_retry: Arc<AtomicBool>,
) -> ReconnectHooks {
    let serial_sessions = app.state::<AppState>().serial_sessions.clone();
    ReconnectHooks {
        auto_retry: Some(auto_retry),
        notice: Box::new(crate::deadmode::disconnect_notice),
        // Serial devices emit no startup frame — nothing to preserve against.
        pre_resume: Box::new(Vec::new),
        on_state: {
            let id = id.clone();
            Box::new(move |alive| {
                let _ = app.emit(
                    "session-state",
                    SessionState {
                        id: id.clone(),
                        alive,
                    },
                );
            })
        },
        respawn: Box::new(move || {
            let SpawnSpec::Serial {
                port_name,
                baud_rate,
                data_bits,
                parity,
                stop_bits,
                flow_control,
                output_newline,
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
                None => open_serial(
                    port_name,
                    *baud_rate,
                    *data_bits,
                    parity,
                    *stop_bits,
                    flow_control,
                )?,
            };
            let (reader, writer, cancel, ctl) =
                start_pump(port, nl_mode, is_hardware_flow(flow_control));
            serial_sessions.lock().map_err(|e| e.to_string())?.insert(
                id.clone(),
                SerialSession {
                    cancel,
                    ctl,
                    spec: Some(spec.clone()),
                    auto_hold_restore: false,
                },
            );
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
    let hardware_flow = spec
        .as_ref()
        .and_then(|s| match s {
            SpawnSpec::Serial { flow_control, .. } => Some(is_hardware_flow(flow_control)),
            _ => None,
        })
        .unwrap_or(false);
    let (reader, writer, cancel, ctl_tx) = start_pump(port, nl_mode, hardware_flow);
    let hooks = spec.clone().map(|s| {
        let auto = state.register_auto_reconnect(&id);
        serial_hooks(app.clone(), id.clone(), s, auto)
    });
    register_session(&state.hub, &id, reader, writer, hooks)?;

    state
        .serial_sessions
        .lock()
        .map_err(|e| e.to_string())?
        .insert(
            id,
            SerialSession {
                cancel,
                ctl: ctl_tx,
                spec,
                auto_hold_restore: false,
            },
        );

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
        &state,
        &app,
        id.clone(),
        &port_name,
        baud_rate,
        data_bits,
        &parity,
        stop_bits,
        &flow_control,
        nl,
    )?;

    Ok(state.ws_result(id))
}

#[tauri::command]
pub fn serial_set_baud(
    state: tauri::State<AppState>,
    id: &str,
    baud_rate: u32,
) -> Result<(), String> {
    let mut sessions = state.serial_sessions.lock().map_err(|e| e.to_string())?;
    let session = sessions
        .get_mut(id)
        .ok_or_else(|| format!("No serial session: {}", id))?;
    // Keep the spec in sync so (auto-)reconnect reopens at the current baud.
    if let Some(SpawnSpec::Serial {
        baud_rate: spec_baud,
        ..
    }) = &mut session.spec
    {
        *spec_baud = baud_rate;
    }
    session
        .ctl
        .send(SerialCtl::SetBaud(baud_rate))
        .map_err(|e| format!("Serial session closed: {}", e))
}

// Drive the RTS modem line (quick panel toggle).
#[tauri::command]
pub fn serial_set_rts(state: tauri::State<AppState>, id: &str, on: bool) -> Result<(), String> {
    let sessions = state.serial_sessions.lock().map_err(|e| e.to_string())?;
    let session = sessions
        .get(id)
        .ok_or_else(|| format!("No serial session: {}", id))?;
    session
        .ctl
        .send(SerialCtl::SetRts(on))
        .map_err(|e| format!("Serial session closed: {}", e))
}

// Drive the DTR modem line (quick panel toggle).
#[tauri::command]
pub fn serial_set_dtr(state: tauri::State<AppState>, id: &str, on: bool) -> Result<(), String> {
    let sessions = state.serial_sessions.lock().map_err(|e| e.to_string())?;
    let session = sessions
        .get(id)
        .ok_or_else(|| format!("No serial session: {}", id))?;
    session
        .ctl
        .send(SerialCtl::SetDtr(on))
        .map_err(|e| format!("Serial session closed: {}", e))
}

// Switch flow control on a live session (no port reopen).
#[tauri::command]
pub fn serial_set_flow_control(
    state: tauri::State<AppState>,
    id: &str,
    flow: &str,
) -> Result<(), String> {
    map_flow_control(flow)?; // validate before touching the session
    let mut sessions = state.serial_sessions.lock().map_err(|e| e.to_string())?;
    let session = sessions
        .get_mut(id)
        .ok_or_else(|| format!("No serial session: {}", id))?;
    // Keep the spec in sync so (auto-)reconnect reopens with it.
    if let Some(SpawnSpec::Serial { flow_control, .. }) = &mut session.spec {
        *flow_control = flow.to_string();
    }
    session
        .ctl
        .send(SerialCtl::SetFlowControl(flow.to_string()))
        .map_err(|e| format!("Serial session closed: {}", e))
}

// Manually release the port (quick panel "Disconnect"): the pump stops and
// the OS handle is dropped, so other tools (Arduino uploads, …) can claim
// the device. The relay slot enters dead mode; auto-reconnect is suppressed
// while held (the preference is restored on reconnect).
#[tauri::command]
pub fn serial_disconnect(state: tauri::State<AppState>, id: &str) -> Result<(), String> {
    let mut sessions = state.serial_sessions.lock().map_err(|e| e.to_string())?;
    let session = sessions
        .get_mut(id)
        .ok_or_else(|| format!("No serial session: {}", id))?;
    if let Ok(map) = state.auto_reconnect.lock() {
        if let Some(flag) = map.get(id) {
            session.auto_hold_restore = flag.swap(false, Ordering::Relaxed);
        }
    }
    session.cancel.store(true, Ordering::Relaxed);
    Ok(())
}

// Reconnect after a manual release. Refuses when the session is still alive
// (feeding Enter would send a stray CR to the device instead of respawning).
#[tauri::command]
pub async fn serial_reconnect(state: tauri::State<'_, AppState>, id: String) -> Result<(), String> {
    let restore = {
        let sessions = state.serial_sessions.lock().map_err(|e| e.to_string())?;
        sessions
            .get(id.as_str())
            .ok_or_else(|| format!("No serial session: {}", id))?
            .auto_hold_restore
    };
    if serial_pump_alive(&state, &id) {
        return Err("Session is still connected".into());
    }
    if let Ok(map) = state.auto_reconnect.lock() {
        if let Some(flag) = map.get(id.as_str()) {
            flag.store(restore, Ordering::Relaxed);
        }
    }
    // Press Enter at the dead-mode prompt — the exact same respawn path as
    // the user's keyboard. The relay exposes no output/scrollback-seq signal
    // to wait on, and its Enter watcher is installed asynchronously once the
    // read pump notices the cancelled pump's EOF, so poll instead of holding
    // a fixed sleep: see wait_for_reconnect_prompt.
    wait_for_reconnect_prompt(&state, &id).await
}

// Liveness probe: a live pump answers QueryLines; a dead one's sender is
// dropped (or never replies) once the thread exited. Re-fetches the ctl
// handle on every call because a respawn replaces the session entry.
fn serial_pump_alive(state: &AppState, id: &str) -> bool {
    let ctl = {
        let Ok(sessions) = state.serial_sessions.lock() else {
            return false;
        };
        match sessions.get(id) {
            Some(s) => s.ctl.clone(),
            None => return false,
        }
    };
    let (tx, rx) = std::sync::mpsc::channel();
    ctl.send(SerialCtl::QueryLines(tx)).is_ok()
        && rx.recv_timeout(Duration::from_millis(300)).is_ok()
}

// How long serial_reconnect waits for the relay's dead-mode Enter watcher
// before giving up, and the poll cadence between attempts.
const RECONNECT_WAIT_TIMEOUT: Duration = Duration::from_secs(2);
const RECONNECT_POLL_INTERVAL: Duration = Duration::from_millis(25);

// Feed Enter at the dead-mode prompt, waiting adaptively for the relay to
// install its Enter watcher: a feed failing with PUMP_GONE means the write
// hit the dead session's orphaned writer (watcher not installed yet) and is
// retried; a successful feed delivers exactly one Enter (failed feeds never
// reached the single-fire watcher, so no double respawn). The liveness
// re-check stops the wait if auto-reconnect respawned the session
// concurrently — feeding Enter then would send a stray CR to the device.
async fn wait_for_reconnect_prompt(state: &AppState, id: &str) -> Result<(), String> {
    retry_until_ready(
        RECONNECT_WAIT_TIMEOUT,
        RECONNECT_POLL_INTERVAL,
        "session did not reach the reconnect prompt",
        || {
            if serial_pump_alive(state, id) {
                // Respawned concurrently (auto-reconnect): nothing to press.
                return Ok(true);
            }
            match crate::relay::feed_upstream(&state.hub, id, b"\r") {
                Ok(()) => Ok(true),
                Err(e) if e == PUMP_GONE => Ok(false),
                Err(e) => Err(e),
            }
        },
    )
    .await
}

// Poll `attempt` until it reports ready, fails hard, or `timeout` elapses
// (waiting `interval` between retries). `attempt` returns Ok(true) when
// done, Ok(false) to retry, Err to abort. Generic so the timing loop is
// unit-testable without serial hardware or a relay hub.
async fn retry_until_ready<F>(
    timeout: Duration,
    interval: Duration,
    timeout_err: &str,
    mut attempt: F,
) -> Result<(), String>
where
    F: FnMut() -> Result<bool, String>,
{
    let start = std::time::Instant::now();
    loop {
        match attempt() {
            Ok(true) => return Ok(()),
            Ok(false) if start.elapsed() < timeout => tokio::time::sleep(interval).await,
            Ok(false) => return Err(timeout_err.to_string()),
            Err(e) => return Err(e),
        }
    }
}

// Sample the modem lines for the quick panel (RTS tracked, CTS read live).
#[tauri::command]
pub fn serial_line_status(
    state: tauri::State<AppState>,
    id: &str,
) -> Result<crate::state::SerialLineState, String> {
    let sessions = state.serial_sessions.lock().map_err(|e| e.to_string())?;
    let session = sessions
        .get(id)
        .ok_or_else(|| format!("No serial session: {}", id))?;
    let (tx, rx) = std::sync::mpsc::channel();
    session
        .ctl
        .send(SerialCtl::QueryLines(tx))
        .map_err(|e| format!("Serial session closed: {}", e))?;
    drop(sessions);
    rx.recv_timeout(std::time::Duration::from_secs(2))
        .map_err(|_| "Serial session did not answer line query".to_string())
}

#[tauri::command]
pub fn serial_set_output_newline(
    state: tauri::State<AppState>,
    id: &str,
    mode: &str,
) -> Result<(), String> {
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
        assert!(matches!(
            map_data_bits(5).unwrap(),
            serialport::DataBits::Five
        ));
        assert!(matches!(
            map_data_bits(8).unwrap(),
            serialport::DataBits::Eight
        ));
    }

    #[test]
    fn serial_data_bits_rejects_invalid() {
        assert!(map_data_bits(4).is_err());
        assert!(map_data_bits(9).is_err());
    }

    #[test]
    fn serial_parity_case_insensitive() {
        assert!(matches!(
            map_parity("none").unwrap(),
            serialport::Parity::None
        ));
        assert!(matches!(
            map_parity("Odd").unwrap(),
            serialport::Parity::Odd
        ));
        assert!(matches!(
            map_parity("EVEN").unwrap(),
            serialport::Parity::Even
        ));
        assert!(map_parity("mark").is_err());
    }

    #[test]
    fn serial_stop_bits() {
        assert!(matches!(
            map_stop_bits(1).unwrap(),
            serialport::StopBits::One
        ));
        assert!(matches!(
            map_stop_bits(2).unwrap(),
            serialport::StopBits::Two
        ));
        assert!(map_stop_bits(3).is_err());
    }

    #[test]
    fn serial_flow_control_aliases() {
        assert!(matches!(
            map_flow_control("none").unwrap(),
            serialport::FlowControl::None
        ));
        assert!(matches!(
            map_flow_control("xonxoff").unwrap(),
            serialport::FlowControl::Software
        ));
        assert!(matches!(
            map_flow_control("rtscts").unwrap(),
            serialport::FlowControl::Hardware
        ));
        assert!(map_flow_control("magic").is_err());
    }

    #[test]
    fn open_serial_invalid_port_returns_err_not_panic() {
        // Smoke test: nonexistent port must fail gracefully.
        // COM254 is essentially never present on real systems.
        let result = open_serial("\\\\.\\COM254", 115200, 8, "none", 1, "none");
        assert!(result.is_err());
        let msg = result.err().unwrap();
        assert!(
            msg.contains("COM254"),
            "error should name the port: {}",
            msg
        );
    }

    #[test]
    fn open_serial_invalid_params_rejected_before_open() {
        let result = open_serial("\\\\.\\COM254", 115200, 9, "none", 1, "none");
        assert!(result.err().unwrap().contains("data bits"));
    }
    // -- I/O pump write backpressure (CDC devices that never read) --

    // Port whose writes return TimedOut while `timeouts_left` > 0
    // (or fail fatally when `fatal` is set). Reads come from `read_rx`
    // when set (simulating device output), otherwise always time out.
    struct BackpressurePort {
        timeouts_left: usize,
        fatal: bool,
        written: std::sync::Arc<parking_lot::Mutex<Vec<u8>>>,
        read_rx: Option<std::sync::mpsc::Receiver<Vec<u8>>>,
        // When set, set_baud_rate / set_flow_control deassert DTR (Windows
        // SetCommState + DTR_CONTROL_DISABLE) so restore_driven_lines can
        // be asserted.
        dtr_line: Option<std::sync::Arc<parking_lot::Mutex<bool>>>,
        rts_line: Option<std::sync::Arc<parking_lot::Mutex<bool>>>,
    }

    impl std::io::Read for BackpressurePort {
        fn read(&mut self, out: &mut [u8]) -> std::io::Result<usize> {
            if let Some(rx) = &self.read_rx {
                if let Ok(data) = rx.recv_timeout(Duration::from_millis(20)) {
                    let n = data.len().min(out.len());
                    out[..n].copy_from_slice(&data[..n]);
                    return Ok(n);
                }
            }
            Err(std::io::Error::new(
                std::io::ErrorKind::TimedOut,
                "mock read timeout",
            ))
        }
    }

    impl std::io::Write for BackpressurePort {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            if self.fatal {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::PermissionDenied,
                    "mock fatal write",
                ));
            }
            if self.timeouts_left > 0 {
                self.timeouts_left -= 1;
                return Err(std::io::Error::new(
                    std::io::ErrorKind::TimedOut,
                    "mock write timeout",
                ));
            }
            self.written.lock().extend_from_slice(buf);
            Ok(buf.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    impl serialport::SerialPort for BackpressurePort {
        fn name(&self) -> Option<String> {
            Some("MOCK-BACKPRESSURE".into())
        }
        fn baud_rate(&self) -> serialport::Result<u32> {
            Ok(115200)
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
            Duration::from_millis(1)
        }
        fn set_baud_rate(&mut self, _: u32) -> serialport::Result<()> {
            if let Some(dtr) = &self.dtr_line {
                *dtr.lock() = false;
            }
            Ok(())
        }
        fn set_data_bits(&mut self, _: serialport::DataBits) -> serialport::Result<()> {
            Ok(())
        }
        fn set_flow_control(&mut self, _: serialport::FlowControl) -> serialport::Result<()> {
            if let Some(dtr) = &self.dtr_line {
                *dtr.lock() = false;
            }
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
        fn write_request_to_send(&mut self, level: bool) -> serialport::Result<()> {
            if let Some(rts) = &self.rts_line {
                *rts.lock() = level;
            }
            Ok(())
        }
        fn write_data_terminal_ready(&mut self, level: bool) -> serialport::Result<()> {
            if let Some(dtr) = &self.dtr_line {
                *dtr.lock() = level;
            }
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
            Err(serialport::Error::new(
                serialport::ErrorKind::NoDevice,
                "no clone",
            ))
        }
        fn set_break(&self) -> serialport::Result<()> {
            Ok(())
        }
        fn clear_break(&self) -> serialport::Result<()> {
            Ok(())
        }
    }

    fn spawn_pump(
        port: BackpressurePort,
        nl_mode: crate::newline::NewlineMode,
    ) -> (
        std::sync::mpsc::Sender<Vec<u8>>,
        std::sync::mpsc::Sender<SerialCtl>,
        std::sync::mpsc::Receiver<Vec<u8>>,
        Arc<AtomicBool>,
        std::thread::JoinHandle<()>,
    ) {
        spawn_pump_hw(port, nl_mode, false)
    }

    fn spawn_pump_hw(
        port: BackpressurePort,
        nl_mode: crate::newline::NewlineMode,
        hardware_flow: bool,
    ) -> (
        std::sync::mpsc::Sender<Vec<u8>>,
        std::sync::mpsc::Sender<SerialCtl>,
        std::sync::mpsc::Receiver<Vec<u8>>,
        Arc<AtomicBool>,
        std::thread::JoinHandle<()>,
    ) {
        let (out_tx, out_rx) = std::sync::mpsc::channel();
        let (in_tx, in_rx) = std::sync::mpsc::channel();
        let (ctl_tx, ctl_rx) = std::sync::mpsc::channel();
        let cancel = Arc::new(AtomicBool::new(false));
        let cancel2 = cancel.clone();
        let handle = std::thread::spawn(move || {
            serial_io_loop(
                Box::new(port),
                out_tx,
                in_rx,
                ctl_rx,
                cancel2,
                NewlineFilter::new(nl_mode),
                hardware_flow,
            )
        });
        (in_tx, ctl_tx, out_rx, cancel, handle)
    }

    #[test]
    fn pump_survives_write_timeouts_and_preserves_order() {
        let written = std::sync::Arc::new(parking_lot::Mutex::new(Vec::new()));
        let port = BackpressurePort {
            timeouts_left: 5,
            fatal: false,
            written: written.clone(),
            read_rx: None,
            dtr_line: None,
            rts_line: None,
        };
        let (in_tx, _ctl, _out, cancel, handle) =
            spawn_pump(port, crate::newline::NewlineMode::Keep);
        in_tx.send(b"abc".to_vec()).unwrap();
        in_tx.send(b"def".to_vec()).unwrap();
        let deadline = std::time::Instant::now() + Duration::from_secs(2);
        while std::time::Instant::now() < deadline {
            if written.lock().as_slice() == b"abcdef" {
                break;
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        assert_eq!(
            written.lock().as_slice(),
            b"abcdef",
            "deferred bytes must reach the device in order"
        );
        assert!(
            !handle.is_finished(),
            "write timeouts must not kill the pump"
        );
        cancel.store(true, Ordering::Relaxed);
        handle.join().unwrap();
    }

    #[test]
    fn pump_still_dies_on_fatal_write_error() {
        let written = std::sync::Arc::new(parking_lot::Mutex::new(Vec::new()));
        let port = BackpressurePort {
            timeouts_left: 0,
            fatal: true,
            written,
            read_rx: None,
            dtr_line: None,
            rts_line: None,
        };
        let (in_tx, _ctl, _out, _cancel, handle) =
            spawn_pump(port, crate::newline::NewlineMode::Keep);
        in_tx.send(b"x".to_vec()).unwrap();
        let deadline = std::time::Instant::now() + Duration::from_secs(2);
        while std::time::Instant::now() < deadline && !handle.is_finished() {
            std::thread::sleep(Duration::from_millis(5));
        }
        assert!(
            handle.is_finished(),
            "non-timeout write errors must remain fatal"
        );
        handle.join().unwrap();
    }

    fn wait_dtr(line: &std::sync::Arc<parking_lot::Mutex<bool>>, want: bool) -> bool {
        let deadline = std::time::Instant::now() + Duration::from_secs(2);
        while std::time::Instant::now() < deadline {
            if *line.lock() == want {
                return true;
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        false
    }

    // Windows SetCommState (baud / flow change) deasserts DTR; the pump
    // must write it back so Pico-class CDC devices stay alive.
    #[test]
    fn pump_restores_dtr_after_baud_change() {
        let dtr_line = std::sync::Arc::new(parking_lot::Mutex::new(false));
        let port = BackpressurePort {
            timeouts_left: 0,
            fatal: false,
            written: std::sync::Arc::new(parking_lot::Mutex::new(Vec::new())),
            read_rx: None,
            dtr_line: Some(dtr_line.clone()),
            rts_line: None,
        };
        let (_in, ctl, _out, cancel, handle) = spawn_pump(port, crate::newline::NewlineMode::Keep);
        ctl.send(SerialCtl::SetBaud(9600)).unwrap();
        assert!(
            wait_dtr(&dtr_line, true),
            "DTR must be restored after set_baud_rate"
        );
        cancel.store(true, Ordering::Relaxed);
        handle.join().unwrap();
    }

    #[test]
    fn pump_restores_dtr_after_flow_control_change() {
        let dtr_line = std::sync::Arc::new(parking_lot::Mutex::new(false));
        let port = BackpressurePort {
            timeouts_left: 0,
            fatal: false,
            written: std::sync::Arc::new(parking_lot::Mutex::new(Vec::new())),
            read_rx: None,
            dtr_line: Some(dtr_line.clone()),
            rts_line: None,
        };
        let (_in, ctl, _out, cancel, handle) = spawn_pump(port, crate::newline::NewlineMode::Keep);
        ctl.send(SerialCtl::SetFlowControl("none".into())).unwrap();
        assert!(
            wait_dtr(&dtr_line, true),
            "DTR must be restored after set_flow_control"
        );
        cancel.store(true, Ordering::Relaxed);
        handle.join().unwrap();
    }

    // Hardware RTS/CTS owns RTS; software SetRts must not fight the
    // driver. DTR is not part of that handshake and stays writable.
    #[test]
    fn pump_ignores_software_rts_under_hardware_flow() {
        let rts_line = std::sync::Arc::new(parking_lot::Mutex::new(false));
        let dtr_line = std::sync::Arc::new(parking_lot::Mutex::new(true));
        let port = BackpressurePort {
            timeouts_left: 0,
            fatal: false,
            written: std::sync::Arc::new(parking_lot::Mutex::new(Vec::new())),
            read_rx: None,
            dtr_line: Some(dtr_line.clone()),
            rts_line: Some(rts_line.clone()),
        };
        let (_in, ctl, _out, cancel, handle) =
            spawn_pump_hw(port, crate::newline::NewlineMode::Keep, true);
        ctl.send(SerialCtl::SetRts(true)).unwrap();
        let deadline = std::time::Instant::now() + Duration::from_millis(200);
        while std::time::Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(5));
        }
        assert!(
            !*rts_line.lock(),
            "software SETRTS must not reach the port under hardware flow"
        );
        ctl.send(SerialCtl::SetDtr(false)).unwrap();
        assert!(
            wait_dtr(&dtr_line, false),
            "DTR stays software-controlled under hardware flow"
        );
        let (reply_tx, reply_rx) = std::sync::mpsc::channel();
        ctl.send(SerialCtl::QueryLines(reply_tx)).unwrap();
        let st = reply_rx.recv_timeout(Duration::from_secs(2)).unwrap();
        assert!(st.rts, "query reports driver-owned RTS as asserted");
        assert!(!st.dtr, "query reflects the software DTR we just drove");
        cancel.store(true, Ordering::Relaxed);
        handle.join().unwrap();
    }

    // -- I/O pump output newline mode (profile contract) --

    fn collect_until(
        out_rx: &std::sync::mpsc::Receiver<Vec<u8>>,
        expected: &[u8],
        deadline: Duration,
    ) -> Vec<u8> {
        let mut got = Vec::new();
        let end = std::time::Instant::now() + deadline;
        while std::time::Instant::now() < end && got.len() < expected.len() {
            match out_rx.recv_timeout(Duration::from_millis(50)) {
                Ok(chunk) => got.extend_from_slice(&chunk),
                Err(_) => {}
            }
        }
        got
    }

    // The profile's mode is baked into the filter at pump start (spawn):
    // the very first device bytes are already converted, no manual switch
    // needed. Guards the "profile applies at open" contract end to end.
    #[test]
    fn pump_applies_spawn_newline_mode_from_first_byte() {
        let (dev_tx, dev_rx) = std::sync::mpsc::channel();
        let port = BackpressurePort {
            timeouts_left: 0,
            fatal: false,
            written: std::sync::Arc::new(parking_lot::Mutex::new(Vec::new())),
            read_rx: Some(dev_rx),
            dtr_line: None,
            rts_line: None,
        };
        let (_in_tx, _ctl, out_rx, cancel, handle) =
            spawn_pump(port, crate::newline::NewlineMode::CrInLf);
        // ESP32-C3 app output is LF-only (verified on hardware).
        dev_tx
            .send(b"[WiFi] connected\n[Clock] ready\n".to_vec())
            .unwrap();
        let got = collect_until(
            &out_rx,
            b"[WiFi] connected\r\n[Clock] ready\r\n",
            Duration::from_secs(2),
        );
        cancel.store(true, Ordering::Relaxed);
        handle.join().unwrap();
        assert_eq!(got, b"[WiFi] connected\r\n[Clock] ready\r\n");
    }

    // A live mode switch (quick panel / profile change) reaches the pump
    // via SerialCtl and converts subsequent output only.
    #[test]
    fn pump_applies_live_newline_switch() {
        let (dev_tx, dev_rx) = std::sync::mpsc::channel();
        let port = BackpressurePort {
            timeouts_left: 0,
            fatal: false,
            written: std::sync::Arc::new(parking_lot::Mutex::new(Vec::new())),
            read_rx: Some(dev_rx),
            dtr_line: None,
            rts_line: None,
        };
        let (_in_tx, ctl, out_rx, cancel, handle) =
            spawn_pump(port, crate::newline::NewlineMode::Keep);
        dev_tx.send(b"a\n".to_vec()).unwrap();
        assert_eq!(
            collect_until(&out_rx, b"a\n", Duration::from_secs(2)),
            b"a\n",
            "keep mode must pass LF through"
        );
        ctl.send(SerialCtl::SetOutputNewline(
            crate::newline::NewlineMode::CrInLf,
        ))
        .unwrap();
        std::thread::sleep(Duration::from_millis(100)); // let a pump cycle apply it
        dev_tx.send(b"b\n".to_vec()).unwrap();
        assert_eq!(
            collect_until(&out_rx, b"b\r\n", Duration::from_secs(2)),
            b"b\r\n",
            "switched mode must convert subsequent output"
        );
        cancel.store(true, Ordering::Relaxed);
        handle.join().unwrap();
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
        assert_eq!(
            writer.write(b"x").unwrap_err().kind(),
            std::io::ErrorKind::BrokenPipe
        );
    }

    #[test]
    fn serial_io_reader_eof_when_pump_gone() {
        let (tx, rx) = std::sync::mpsc::channel::<Vec<u8>>();
        let mut reader = SerialIoReader {
            rx,
            cur: std::collections::VecDeque::new(),
        };
        tx.send(b"device-data".to_vec()).unwrap();
        drop(tx);
        let mut buf = [0u8; 64];
        let n = reader.read(&mut buf).unwrap();
        assert_eq!(&buf[..n], b"device-data");
        assert_eq!(reader.read(&mut buf).unwrap(), 0);
    }

    // -- reconnect wait (retry_until_ready) --

    #[test]
    fn pump_gone_const_matches_writer_error() {
        // serial_reconnect retries feeds whose error equals PUMP_GONE; this
        // pins the contract between the writer and that match.
        let (tx, rx) = std::sync::mpsc::channel::<Vec<u8>>();
        drop(rx);
        let mut writer = SerialIoWriter { tx };
        assert_eq!(writer.write(b"x").unwrap_err().to_string(), PUMP_GONE);
    }

    #[test]
    fn retry_until_ready_stops_once_signal_observed() {
        tauri::async_runtime::block_on(async {
            let attempts = std::cell::Cell::new(0);
            let result = retry_until_ready(
                Duration::from_secs(2),
                Duration::from_millis(1),
                "timeout",
                || {
                    attempts.set(attempts.get() + 1);
                    Ok(attempts.get() >= 3)
                },
            )
            .await;
            assert!(result.is_ok());
            // No polling past the ready signal.
            assert_eq!(attempts.get(), 3);
        });
    }

    #[test]
    fn retry_until_ready_times_out_when_signal_never_comes() {
        tauri::async_runtime::block_on(async {
            let start = std::time::Instant::now();
            let result = retry_until_ready(
                Duration::from_millis(30),
                Duration::from_millis(5),
                "not ready",
                || Ok(false),
            )
            .await;
            assert_eq!(result.unwrap_err(), "not ready");
            assert!(start.elapsed() >= Duration::from_millis(30));
        });
    }

    #[test]
    fn retry_until_ready_aborts_on_hard_error() {
        tauri::async_runtime::block_on(async {
            let attempts = std::cell::Cell::new(0);
            let result = retry_until_ready(
                Duration::from_secs(2),
                Duration::from_millis(1),
                "timeout",
                || {
                    attempts.set(attempts.get() + 1);
                    Err("boom".to_string())
                },
            )
            .await;
            assert_eq!(result.unwrap_err(), "boom");
            // Hard errors are not retried.
            assert_eq!(attempts.get(), 1);
        });
    }
}
