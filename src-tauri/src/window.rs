use tauri_plugin_dialog::DialogExt;

#[tauri::command]
pub fn window_minimize(window: tauri::Window) {
    let _ = window.minimize();
}

#[tauri::command]
pub fn window_toggle_maximize(window: tauri::Window) {
    if window.is_maximized().unwrap_or(false) {
        let _ = window.unmaximize();
    } else {
        let _ = window.maximize();
    }
}

#[tauri::command]
pub fn window_close(window: tauri::Window) {
    let _ = window.close();
}

#[tauri::command]
pub fn window_start_drag(window: tauri::Window) -> Result<(), String> {
    window.start_dragging().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn open_new_window(state: tauri::State<crate::state::AppState>) -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let mut cmd = std::process::Command::new(exe);
    if let Some(cwd) = &state.initial_cwd {
        cmd.arg("--working-directory").arg(cwd);
    }
    cmd.spawn().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn save_text_file(app: tauri::AppHandle, content: String) -> Result<(), String> {
    let file = app.dialog()
        .file()
        .add_filter("Text", &["txt", "log"])
        .set_file_name("terminal-output.txt")
        .blocking_save_file();

    if let Some(path) = file {
        if let Some(p) = path.as_path() {
            std::fs::write(p, &content).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}
