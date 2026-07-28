use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};
use std::collections::HashMap;
use tauri::{Emitter, Manager};

use crate::cmdparse::parse_command;
use crate::relay::{register_session, unregister_session, ReconnectHooks};
use crate::state::{AppState, PtySession, SessionState, SpawnSpec, WsConnectResult};

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

// Open a PTY, spawn the child, register it in the session table, and arm the
// exit watchdog. Returns the (reader, writer) ends for the relay. Shared by
// the initial spawn and the dead-mode respawn (Enter-to-reconnect).
fn spawn_pty_child(
    sessions: &Arc<Mutex<HashMap<String, PtySession>>>,
    id: &str,
    cmd: CommandBuilder,
    size: PtySize,
) -> Result<(Box<dyn Read + Send>, Box<dyn Write + Send>), String> {
    let pty_sys = native_pty_system();
    let pty_pair = pty_sys.openpty(size).map_err(|e| e.to_string())?;

    let mut child = pty_pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| e.to_string())?;

    drop(pty_pair.slave);

    let master = pty_pair.master;
    let reader = master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer: Box<dyn Write + Send> = master.take_writer().map_err(|e| e.to_string())?;

    let nonce = SESSION_NONCE.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    sessions.lock().map_err(|e| e.to_string())?.insert(
        id.to_string(),
        PtySession { master: Some(master), nonce, size },
    );

    // Watchdog: when the child exits, drop the master from the session table.
    // ConPTY does NOT signal EOF on the output pipe when the child dies, so
    // the relay's read pump would block forever otherwise. Dropping the master
    // closes the PseudoConsole, the read fails, and the relay enters dead mode.
    let sessions_arc = sessions.clone();
    let id2 = id.to_string();
    std::thread::spawn(move || {
        let _ = child.wait();
        if let Ok(mut m) = sessions_arc.lock() {
            // Only touch OUR spawn (not a respawn replacement).
            // Drop the master (closes ConPTY, unblocks the relay read pump)
            // but keep the spec for reconnection.
            if m.get(&id2).map_or(false, |s| s.nonce == nonce) {
                if let Some(s) = m.get_mut(&id2) {
                    s.master = None;
                }
            }
        }
    });

    Ok((reader, writer))
}

// Reconnect hooks for PTY/SSH sessions: the relay calls `respawn` when the
// user presses Enter at the in-band disconnect prompt. Runs on a blocking
// relay thread.
fn pty_hooks(app: tauri::AppHandle, id: String, spec: SpawnSpec) -> ReconnectHooks {
    let state = app.state::<AppState>();
    let sessions = state.sessions.clone();
    let initial_cwd = state.initial_cwd.clone();
    ReconnectHooks {
        notice: Box::new(crate::deadmode::disconnect_notice),
        pre_resume: {
            let sessions = sessions.clone();
            let id = id.clone();
            Box::new(move || {
                let rows = sessions
                    .lock()
                    .ok()
                    .and_then(|t| t.get(&id).map(|s| s.size.rows))
                    .unwrap_or(24);
                crate::deadmode::resume_scroll(rows)
            })
        },
        on_state: {
            let id = id.clone();
            Box::new(move |alive| {
                let _ = app.emit("session-state", SessionState { id: id.clone(), alive });
            })
        },
        respawn: Box::new(move || {
            let builder = match &spec {
                SpawnSpec::Pty { command } => command_builder(command.as_deref(), initial_cwd.as_ref()),
                SpawnSpec::Ssh { hostname, port, user } => {
                    let mut cmd = CommandBuilder::new("ssh");
                    cmd.arg(format!("{}@{}", user, hostname));
                    cmd.arg("-p");
                    cmd.arg(port.to_string());
                    cmd
                }
                _ => return Err("not a PTY session".into()),
            };
            // Respawn at the last known terminal size (updated by pty_resize),
            // not the 80x24 default.
            let size = {
                let table = sessions.lock().map_err(|e| e.to_string())?;
                table.get(&id).map(|s| s.size).unwrap_or(PtySize {
                    rows: 24,
                    cols: 80,
                    pixel_width: 0,
                    pixel_height: 0,
                })
            };
            spawn_pty_child(&sessions, &id, builder, size)
        }),
    }
}

pub(crate) fn spawn_pty(app_handle: tauri::AppHandle, id: String, cmd: CommandBuilder, spec: SpawnSpec) -> Result<(), String> {
    let sessions = app_handle.state::<AppState>().sessions.clone();
    let (reader, writer) = spawn_pty_child(
        &sessions,
        &id,
        cmd,
        PtySize { rows: 24, cols: 80, pixel_width: 0, pixel_height: 0 },
    )?;
    let hub = app_handle.state::<AppState>().hub.clone();
    register_session(&hub, &id, reader, writer, Some(pty_hooks(app_handle, id.clone(), spec)))?;
    Ok(())
}

// Apply the launch-time working directory (if any) to a command builder.
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
    spawn_pty(app.clone(), id.clone(), builder, spec)?;

    Ok(state.ws_result(id))
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
    spawn_pty(app, id.clone(), cmd, spec)?;
    Ok(state.ws_result(id))
}

#[tauri::command]
pub fn pty_resize(state: tauri::State<AppState>, id: &str, cols: u16, rows: u16) -> Result<(), String> {
    let mut sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    if let Some(session) = sessions.get_mut(id) {
        let size = PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        };
        // Always remember the size — a dead session respawns at it.
        session.size = size;
        if let Some(master) = &session.master {
            master.resize(size).map_err(|e| e.to_string())?;
        }
        // master None (child exited): resize is a no-op until reconnect
    }
    Ok(())
}

// Kill a session's resources (PTY master or serial pump) without touching specs.
fn kill_session_resources(state: &AppState, id: &str) -> Result<(), String> {
    unregister_session(&state.hub, id);
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
pub fn pty_kill(state: tauri::State<AppState>, id: &str) -> Result<(), String> {
    kill_session_resources(&state, id)
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

