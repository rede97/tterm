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

// Explicit variants for zen mode (F11): a toggle would fight the frontend's
// saved pre-zen maximized state when the user resizes mid-gesture.
#[tauri::command]
pub fn window_maximize(window: tauri::Window) {
    let _ = window.maximize();
}

#[tauri::command]
pub fn window_unmaximize(window: tauri::Window) {
    let _ = window.unmaximize();
}

// Browser-style fullscreen (covers the taskbar) for the F11 shortcut. The
// JS Window API's set_fullscreen is not in our capabilities either, so the
// frontend goes through this command like the maximize path.
#[tauri::command]
pub fn window_set_fullscreen(window: tauri::Window, on: bool) {
    let _ = window.set_fullscreen(on);
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

// Async + non-blocking dialog: a blocking_pick_folder() on the main thread
// freezes the WebView2 message pump, so Windows marks the window
// "Not Responding" while the folder picker is open.
#[tauri::command]
pub async fn pick_directory(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog().file().pick_folder(move |path| {
        let _ = tx.send(path);
    });
    let path = rx.await.map_err(|e| e.to_string())?;
    Ok(path.and_then(|p| p.as_path().map(|p| p.to_string_lossy().to_string())))
}

#[tauri::command]
pub async fn save_text_file(app: tauri::AppHandle, content: String) -> Result<(), String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .add_filter("Text", &["txt", "log"])
        .set_file_name("terminal-output.txt")
        .save_file(move |path| {
            let _ = tx.send(path);
        });

    let file = rx.await.map_err(|e| e.to_string())?;
    if let Some(path) = file {
        if let Some(p) = path.as_path() {
            std::fs::write(p, &content).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}
