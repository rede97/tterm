use portable_pty::{native_pty_system, CommandBuilder, PtySize, MasterPty};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Mutex;
use tauri::{Emitter, Manager};

#[derive(Clone, Serialize)]
struct PtyOutput {
    id: String,
    data: Vec<u8>,
}

struct PtySession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
}

struct AppState {
    sessions: Mutex<HashMap<String, PtySession>>,
    next_id: Mutex<u32>,
}

fn get_shell() -> String {
    #[cfg(target_os = "windows")]
    {
        "cmd.exe".into()
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into())
    }
}

fn spawn_pty(app_handle: tauri::AppHandle, id: String, cmd: CommandBuilder) -> Result<(), String> {
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
    let mut reader = master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = master.take_writer().map_err(|e| e.to_string())?;

    // background thread: read PTY output → emit to frontend with tab id
    let emit_id = id.clone();
    let emit_handle = app_handle.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let _ = emit_handle.emit(
                        "pty-output",
                        PtyOutput {
                            id: emit_id.clone(),
                            data: buf[..n].to_vec(),
                        },
                    );
                }
                Err(_) => break,
            }
        }
    });

    let sessions = app_handle.state::<AppState>();
    sessions.sessions.lock().unwrap().insert(
        id,
        PtySession { master, writer },
    );

    Ok(())
}

#[tauri::command]
fn pty_spawn(state: tauri::State<AppState>, app: tauri::AppHandle) -> Result<String, String> {
    let mut next = state.next_id.lock().map_err(|e| e.to_string())?;
    let id = format!("tab-{}", *next);
    *next += 1;
    drop(next);

    let shell = get_shell();
    spawn_pty(app, id.clone(), CommandBuilder::new(&shell))?;
    Ok(id)
}

#[tauri::command]
fn pty_spawn_ssh(state: tauri::State<AppState>, app: tauri::AppHandle, hostname: String, port: u16, user: String) -> Result<String, String> {
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

    spawn_pty(app, id.clone(), cmd)?;
    Ok(id)
}

#[tauri::command]
fn pty_write(state: tauri::State<AppState>, id: &str, data: &str) -> Result<(), String> {
    let mut sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    if let Some(session) = sessions.get_mut(id) {
        session
            .writer
            .write_all(data.as_bytes())
            .map_err(|e| e.to_string())?;
        session.writer.flush().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn pty_resize(state: tauri::State<AppState>, id: &str, cols: u16, rows: u16) -> Result<(), String> {
    let sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    if let Some(session) = sessions.get(id) {
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
fn pty_kill(state: tauri::State<AppState>, id: &str) -> Result<(), String> {
    let mut sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    sessions.remove(id);
    Ok(())
}

#[tauri::command]
fn window_minimize(window: tauri::Window) {
    let _ = window.minimize();
}

#[tauri::command]
fn window_toggle_maximize(window: tauri::Window) {
    if window.is_maximized().unwrap_or(false) {
        let _ = window.unmaximize();
    } else {
        let _ = window.maximize();
    }
}

#[tauri::command]
fn window_close(window: tauri::Window) {
    let _ = window.close();
}

#[tauri::command]
fn window_start_drag(window: tauri::Window) -> Result<(), String> {
    window.start_dragging().map_err(|e| e.to_string())
}

// ── SSH config parsing ──────────────────────────────────────────────

#[derive(Clone, Serialize, Debug)]
struct SshHost {
    name: String,
    hostname: String,
    port: u16,
    user: String,
}

fn ssh_config_path() -> Option<std::path::PathBuf> {
    #[cfg(target_os = "windows")]
    {
        std::env::var("USERPROFILE").ok().map(|p| std::path::PathBuf::from(p).join(".ssh").join("config"))
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::env::var("HOME").ok().map(|p| std::path::PathBuf::from(p).join(".ssh").join("config"))
    }
}

#[derive(Default)]
struct ParsedHost {
    names: Vec<String>,
    hostname: Option<String>,
    port: Option<u16>,
    user: Option<String>,
}

fn parse_ssh_config(content: &str) -> Vec<SshHost> {
    let mut hosts: Vec<ParsedHost> = Vec::new();
    let mut current: Option<ParsedHost> = None;
    let mut pre_host_props = ParsedHost::default();
    let mut wildcard: Option<ParsedHost> = None;

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let (key, value) = match trimmed.split_once(char::is_whitespace) {
            Some((k, v)) => (k.to_lowercase(), v.trim().to_string()),
            None => continue,
        };

        match key.as_str() {
            "host" => {
                let prev = current.replace(ParsedHost {
                    names: value.split_whitespace().map(|s| s.to_string()).collect(),
                    ..Default::default()
                });
                if let Some(p) = prev {
                    if p.names.iter().any(|n| n == "*") {
                        wildcard = Some(p);
                    } else {
                        hosts.push(p);
                    }
                }
            }
            "hostname" => {
                let target = current.as_mut().unwrap_or(&mut pre_host_props);
                target.hostname = Some(value);
            }
            "user" => {
                let target = current.as_mut().unwrap_or(&mut pre_host_props);
                target.user = Some(value);
            }
            "port" => {
                let target = current.as_mut().unwrap_or(&mut pre_host_props);
                target.port = value.parse().ok();
            }
            _ => {}
        }
    }

    // save last host
    if let Some(p) = current {
        if p.names.iter().any(|n| n == "*") {
            wildcard = Some(p);
        } else {
            hosts.push(p);
        }
    }

    // merge defaults: pre_host_props < wildcard < per-host props
    hosts.into_iter().map(|h| {
        let hostname = h.hostname
            .or_else(|| wildcard.as_ref().and_then(|w| w.hostname.clone()))
            .or(pre_host_props.hostname.clone())
            .unwrap_or_else(|| h.names[0].clone());
        let port = h.port
            .or_else(|| wildcard.as_ref().and_then(|w| w.port))
            .or(pre_host_props.port)
            .unwrap_or(22);
        let user = h.user
            .or_else(|| wildcard.as_ref().and_then(|w| w.user.clone()))
            .or(pre_host_props.user.clone())
            .unwrap_or_else(|| "root".into());
        SshHost { name: h.names.join(" "), hostname, port, user }
    }).collect()
}

#[tauri::command]
fn ssh_list_hosts() -> Result<Vec<SshHost>, String> {
    let config_path = ssh_config_path().ok_or("Cannot determine home directory")?;
    if !config_path.exists() {
        return Ok(Vec::new());
    }
    let content = std::fs::read_to_string(&config_path).map_err(|e| e.to_string())?;
    Ok(parse_ssh_config(&content))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // verify PTY system is available
            let _pty_sys = native_pty_system();

            app.manage(AppState {
                sessions: Mutex::new(HashMap::new()),
                next_id: Mutex::new(1),
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![pty_spawn, pty_spawn_ssh, pty_write, pty_resize, pty_kill, window_minimize, window_toggle_maximize, window_close, window_start_drag, ssh_list_hosts])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
