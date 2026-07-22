use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::Ordering;
use tauri::Manager;

use crate::cmdparse::parse_command;
use crate::relay::start_ws_relay;
use crate::state::{AppState, PtySession, WsConnectResult};

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
pub(crate) fn spawn_pty(app_handle: tauri::AppHandle, id: String, cmd: CommandBuilder) -> Result<u16, String> {
    let pty_sys = native_pty_system();
    let pty_pair = pty_sys
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    let _child = pty_pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| e.to_string())?;

    drop(pty_pair.slave);

    let master = pty_pair.master;
    let reader = master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer: Box<dyn Write + Send> = master.take_writer().map_err(|e| e.to_string())?;

    let port = start_ws_relay(reader, writer, None)?;

    // Store session (master for resize)
    let sessions = app_handle.state::<AppState>();
    sessions.sessions.lock().map_err(|e| e.to_string())?.insert(
        id,
        PtySession { master },
    );

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

#[tauri::command]
pub fn pty_spawn(state: tauri::State<AppState>, app: tauri::AppHandle, command: Option<String>) -> Result<WsConnectResult, String> {
    let mut next = state.next_id.lock().map_err(|e| e.to_string())?;
    let id = format!("tab-{}", *next);
    *next += 1;
    drop(next);

    let port = if let Some(cmd) = command {
        if !cmd.is_empty() {
            let (exe, args) = parse_command(&cmd);
            if args.is_empty() {
                let mut builder = CommandBuilder::new(&exe);
                apply_initial_cwd(&mut builder, state.initial_cwd.as_ref());
                spawn_pty(app.clone(), id.clone(), builder)?
            } else {
                let mut builder = CommandBuilder::new(&exe);
                for a in &args { builder.arg(a); }
                apply_initial_cwd(&mut builder, state.initial_cwd.as_ref());
                spawn_pty(app.clone(), id.clone(), builder)?
            }
        } else {
            let shell = get_shell();
            let mut builder = CommandBuilder::new(&shell);
            apply_initial_cwd(&mut builder, state.initial_cwd.as_ref());
            spawn_pty(app.clone(), id.clone(), builder)?
        }
    } else {
        let shell = get_shell();
        let mut builder = CommandBuilder::new(&shell);
        apply_initial_cwd(&mut builder, state.initial_cwd.as_ref());
        spawn_pty(app.clone(), id.clone(), builder)?
    };

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

    let ws_port = spawn_pty(app, id.clone(), cmd)?;
    Ok(WsConnectResult { id, port: ws_port })
}

#[tauri::command]
pub fn pty_resize(state: tauri::State<AppState>, id: &str, cols: u16, rows: u16) -> Result<(), String> {
    let mut sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    if let Some(session) = sessions.get_mut(id) {
        session
            .master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())?;
    }
    Ok(())
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
