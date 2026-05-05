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

fn spawn_pty(app_handle: tauri::AppHandle, id: String, shell: &str) -> Result<(), String> {
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
        .spawn_command(CommandBuilder::new(shell))
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
    spawn_pty(app, id.clone(), &shell)?;
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
        .invoke_handler(tauri::generate_handler![pty_spawn, pty_write, pty_resize, pty_kill])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
