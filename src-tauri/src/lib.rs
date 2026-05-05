use portable_pty::{native_pty_system, CommandBuilder, PtySize, MasterPty};
use std::io::{Read, Write};
use std::sync::Mutex;
use tauri::{Emitter, Manager};

struct AppState {
    master: Mutex<Option<Box<dyn MasterPty + Send>>>,
    writer: Mutex<Option<Box<dyn Write + Send>>>,
}

#[tauri::command]
fn pty_write(state: tauri::State<AppState>, data: &str) -> Result<(), String> {
    if let Some(writer) = state.writer.lock().map_err(|e| e.to_string())?.as_mut() {
        writer.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
        writer.flush().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn pty_resize(state: tauri::State<AppState>, cols: u16, rows: u16) -> Result<(), String> {
    if let Some(master) = state.master.lock().map_err(|e| e.to_string())?.as_ref() {
        master
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            #[cfg(target_os = "windows")]
            let shell = "cmd.exe";
            #[cfg(not(target_os = "windows"))]
            let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into());

            let pty_sys = native_pty_system();
            let pty_pair = pty_sys
                .openpty(PtySize {
                    rows: 24,
                    cols: 80,
                    pixel_width: 0,
                    pixel_height: 0,
                })
                .expect("failed to open PTY");

            let _child = pty_pair
                .slave
                .spawn_command(CommandBuilder::new(shell))
                .expect("failed to spawn shell");

            // slave not needed after spawn
            drop(pty_pair.slave);

            let master = pty_pair.master;
            let mut reader = master
                .try_clone_reader()
                .expect("failed to clone PTY reader");
            let writer = master
                .take_writer()
                .expect("failed to take PTY writer");

            // background thread: read PTY output → emit to frontend
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let mut buf = [0u8; 4096];
                loop {
                    match reader.read(&mut buf) {
                        Ok(0) => break,
                        Ok(n) => {
                            let _ = handle.emit("pty-output", buf[..n].to_vec());
                        }
                        Err(_) => break,
                    }
                }
            });

            app.manage(AppState {
                master: Mutex::new(Some(master)),
                writer: Mutex::new(Some(writer)),
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![pty_write, pty_resize])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
