use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::Ordering;
use tauri::Manager;

use crate::cmdparse::parse_command;
use crate::relay::start_ws_relay;
use crate::state::{AppState, PtySession, SpawnSpec, WsConnectResult};

pub(crate) fn get_shell() -> String {
    #[cfg(target_os = "windows")]
    {
        "cmd.exe".into()
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into())
    }
}
// Monotonic per-spawn token: lets the child-exit watcher avoid removing a
// NEWER session that reused the same tab id (reconnect race).
static SESSION_NONCE: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);

pub(crate) fn spawn_pty(app_handle: tauri::AppHandle, id: String, cmd: CommandBuilder, spec: SpawnSpec) -> Result<u16, String> {
    let pty_sys = native_pty_system();
    let pty_pair = pty_sys
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    let mut child = pty_pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| e.to_string())?;

    drop(pty_pair.slave);

    let master = pty_pair.master;
    let reader = master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer: Box<dyn Write + Send> = master.take_writer().map_err(|e| e.to_string())?;

    let port = start_ws_relay(reader, writer, None)?;

    // Store session (master for resize)
    let nonce = SESSION_NONCE.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let sessions = app_handle.state::<AppState>();
    sessions.sessions.lock().map_err(|e| e.to_string())?.insert(
        id.clone(),
        PtySession { master: Some(master), spec, nonce },
    );

    // Watchdog: when the child exits, drop the master from the session table.
    // ConPTY does NOT signal EOF on the output pipe when the child dies, so
    // the relay's read loop would block forever otherwise. Dropping the master
    // closes the PseudoConsole, the read fails, and the relay closes the WS —
    // which is how the frontend learns the session died.
    let sessions_arc = sessions.sessions.clone();
    std::thread::spawn(move || {
        let _ = child.wait();
        if let Ok(mut m) = sessions_arc.lock() {
            // Only touch OUR spawn (not a reconnect replacement).
            // Drop the master (closes ConPTY, unblocks the relay read loop)
            // but keep the spec for reconnection.
            if m.get(&id).map_or(false, |s| s.nonce == nonce) {
                if let Some(s) = m.get_mut(&id) {
                    s.master = None;
                }
            }
        }
    });

    Ok(port)
}

// Start a WebSocket loopback relay between a byte stream (reader/writer) and
// a single WS client. Returns the bound port. `cancel` lets serial sessions
pub(crate) fn apply_initial_cwd(cmd: &mut CommandBuilder, cwd: Option<&PathBuf>) {
    if let Some(cwd) = cwd {
        if cwd.is_dir() {
            cmd.cwd(cwd);
        }
    }
}

// Build a CommandBuilder for a local session: explicit command (with args),
// or the default shell when command is None/empty.
pub(crate) fn command_builder(command: Option<&str>, initial_cwd: Option<&PathBuf>) -> CommandBuilder {
    let mut builder = match command {
        Some(cmd) if !cmd.is_empty() => {
            let (exe, args) = parse_command(cmd);
            let mut b = CommandBuilder::new(&exe);
            for a in &args {
                b.arg(a);
            }
            b
        }
        _ => CommandBuilder::new(get_shell()),
    };
    apply_initial_cwd(&mut builder, initial_cwd);
    builder
}

#[tauri::command]
pub fn pty_spawn(state: tauri::State<AppState>, app: tauri::AppHandle, command: Option<String>) -> Result<WsConnectResult, String> {
    let mut next = state.next_id.lock().map_err(|e| e.to_string())?;
    let id = format!("tab-{}", *next);
    *next += 1;
    drop(next);

    let spec = SpawnSpec::Pty { command: command.clone() };
    let builder = command_builder(command.as_deref(), state.initial_cwd.as_ref());
    let port = spawn_pty(app.clone(), id.clone(), builder, spec)?;

    Ok(WsConnectResult { id, port })
}

pub(crate) fn launch_working_directory() -> Option<PathBuf> {
    parse_working_dir(std::env::args_os().skip(1))
}

pub(crate) fn parse_working_dir<I: Iterator<Item = std::ffi::OsString>>(mut args: I) -> Option<PathBuf> {
    while let Some(arg) = args.next() {
        if arg == "--working-directory" {
            return args.next().map(PathBuf::from).filter(|path| path.is_dir());
        }
    }
    None
}
#[tauri::command]
pub fn pty_spawn_ssh(state: tauri::State<AppState>, app: tauri::AppHandle, hostname: String, port: u16, user: String) -> Result<WsConnectResult, String> {
    let mut next = state.next_id.lock().map_err(|e| e.to_string())?;
    let id = format!("tab-{}", *next);
    *next += 1;
    drop(next);

    let target = format!("{}@{}", user, hostname);
    let port_str = port.to_string();
    let mut cmd = CommandBuilder::new("ssh");
    cmd.arg(&target);
    cmd.arg("-p");
    cmd.arg(&port_str);

    let spec = SpawnSpec::Ssh { hostname, port, user };
    let ws_port = spawn_pty(app, id.clone(), cmd, spec)?;
    Ok(WsConnectResult { id, port: ws_port })
}

#[tauri::command]
pub fn pty_resize(state: tauri::State<AppState>, id: &str, cols: u16, rows: u16) -> Result<(), String> {
    let mut sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    if let Some(session) = sessions.get_mut(id) {
        if let Some(master) = &session.master {
            master
                .resize(PtySize {
                    rows,
                    cols,
                    pixel_width: 0,
                    pixel_height: 0,
                })
                .map_err(|e| e.to_string())?;
        }
        // master None (child exited): resize is a no-op until reconnect
    }
    Ok(())
}

// Kill a session's resources (PTY master or serial pump) without touching specs.
fn kill_session_resources(state: &AppState, id: &str) -> Result<(), String> {
    {
        let mut sessions = state.sessions.lock().map_err(|e| e.to_string())?;
        sessions.remove(id);
    }
    let mut serial = state.serial_sessions.lock().map_err(|e| e.to_string())?;
    if let Some(session) = serial.remove(id) {
        session.cancel.store(true, Ordering::Relaxed);
    }
    Ok(())
}

#[tauri::command]
pub fn session_reconnect(state: tauri::State<AppState>, app: tauri::AppHandle, id: &str) -> Result<WsConnectResult, String> {
    // 1. Look up the spawn spec in either session table
    let spec = {
        let sessions = state.sessions.lock().map_err(|e| e.to_string())?;
        sessions.get(id).map(|s| s.spec.clone())
    };
    let spec = match spec {
        Some(s) => Some(s),
        None => {
            let serial = state.serial_sessions.lock().map_err(|e| e.to_string())?;
            serial.get(id).and_then(|s| s.spec.clone())
        }
    };
    let spec = spec.ok_or_else(|| format!("Session is not reconnectable: {}", id))?;

    // 2. Tear down the old session
    kill_session_resources(&state, id)?;

    // 3. Respawn with the same id
    let port = match spec {
        SpawnSpec::Pty { command } => {
            let builder = command_builder(command.as_deref(), state.initial_cwd.as_ref());
            spawn_pty(app, id.to_string(), builder, SpawnSpec::Pty { command })?
        }
        SpawnSpec::Ssh { hostname, port, user } => {
            let mut cmd = CommandBuilder::new("ssh");
            cmd.arg(format!("{}@{}", user, hostname));
            cmd.arg("-p");
            cmd.arg(port.to_string());
            spawn_pty(app, id.to_string(), cmd, SpawnSpec::Ssh { hostname, port, user })?
        }
        SpawnSpec::Serial { port_name, baud_rate, data_bits, parity, stop_bits, flow_control, output_newline } => {
            crate::serial::spawn_serial_session(
                &state, id.to_string(), &port_name, baud_rate, data_bits, &parity, stop_bits, &flow_control, &output_newline,
            )?
        }
    };

    Ok(WsConnectResult { id: id.to_string(), port })
}

#[tauri::command]
pub fn pty_kill(state: tauri::State<AppState>, id: &str) -> Result<(), String> {
    let mut sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    sessions.remove(id);
    drop(sessions);
    // Also cancel a serial session with the same id (no-op for PTY tabs)
    let mut serial = state.serial_sessions.lock().map_err(|e| e.to_string())?;
    if let Some(session) = serial.remove(id) {
        session.cancel.store(true, Ordering::Relaxed);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    // -- parse_working_dir --

    #[test]
    fn working_dir_flag_with_existing_dir() {
        let tmp = std::env::temp_dir();
        let args = vec![
            std::ffi::OsString::from("--working-directory"),
            tmp.clone().into_os_string(),
        ];
        assert_eq!(parse_working_dir(args.into_iter()), Some(tmp));
    }

    #[test]
    fn working_dir_flag_absent() {
        let args = vec![std::ffi::OsString::from("--other-flag")];
        assert_eq!(parse_working_dir(args.into_iter()), None);
    }

    #[test]
    fn working_dir_nonexistent_dir_rejected() {
        let args = vec![
            std::ffi::OsString::from("--working-directory"),
            std::ffi::OsString::from("C:\\definitely\\not\\a\\real\\tterm\\dir"),
        ];
        assert_eq!(parse_working_dir(args.into_iter()), None);
    }

    #[test]
    fn working_dir_flag_without_value() {
        let args = vec![std::ffi::OsString::from("--working-directory")];
        assert_eq!(parse_working_dir(args.into_iter()), None);
    }

    // -- get_shell (platform smoke) --

    #[cfg(target_os = "windows")]
    #[test]
    fn get_shell_is_cmd_on_windows() {
        assert_eq!(get_shell(), "cmd.exe");
    }

}
