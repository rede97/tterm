use tauri_plugin_dialog::DialogExt;

// Must match tauri.conf.json `app.windows[0].minWidth` / `minHeight`
// (logical px). window-state restore uses PhysicalSize via SetWindowPos,
// which bypasses WM_GETMINMAXINFO — a corrupt or DPI-mismatched
// `.window-state.json` can therefore land below this floor.
pub(crate) const MIN_WINDOW_WIDTH: f64 = 800.0;
pub(crate) const MIN_WINDOW_HEIGHT: f64 = 600.0;

pub(crate) fn clamp_logical_size(width: f64, height: f64) -> (f64, f64) {
    let w = if width.is_finite() && width > 0.0 {
        width
    } else {
        MIN_WINDOW_WIDTH
    };
    let h = if height.is_finite() && height > 0.0 {
        height
    } else {
        MIN_WINDOW_HEIGHT
    };
    (w.max(MIN_WINDOW_WIDTH), h.max(MIN_WINDOW_HEIGHT))
}

// Re-assert min_size and bump inner size up if restore/DPI put us under
// the floor. Skip maximized/fullscreen/minimized — those are not "tiny
// restored" states and rewriting size would fight zen / the user.
pub(crate) fn enforce_min_size(window: &tauri::Window) {
    let _ = window.set_min_size(Some(tauri::LogicalSize::new(
        MIN_WINDOW_WIDTH,
        MIN_WINDOW_HEIGHT,
    )));
    if window.is_minimized().unwrap_or(false)
        || window.is_maximized().unwrap_or(false)
        || window.is_fullscreen().unwrap_or(false)
    {
        return;
    }
    let Ok(scale) = window.scale_factor() else {
        return;
    };
    let Ok(inner) = window.inner_size() else {
        return;
    };
    if !(scale.is_finite() && scale > 0.0) {
        return;
    }
    let logical_w = f64::from(inner.width) / scale;
    let logical_h = f64::from(inner.height) / scale;
    let (w, h) = clamp_logical_size(logical_w, logical_h);
    if (w - logical_w).abs() < 0.5 && (h - logical_h).abs() < 0.5 {
        return;
    }
    let _ = window.set_size(tauri::LogicalSize::new(w, h));
}

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clamp_raises_below_min() {
        assert_eq!(
            clamp_logical_size(100.0, 50.0),
            (MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT)
        );
    }

    #[test]
    fn clamp_keeps_size_at_or_above_min() {
        assert_eq!(clamp_logical_size(800.0, 600.0), (800.0, 600.0));
        assert_eq!(clamp_logical_size(1280.0, 720.0), (1280.0, 720.0));
    }

    #[test]
    fn clamp_replaces_non_finite_or_non_positive() {
        assert_eq!(
            clamp_logical_size(f64::NAN, f64::INFINITY),
            (MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT)
        );
        assert_eq!(
            clamp_logical_size(0.0, -10.0),
            (MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT)
        );
    }

    #[test]
    fn clamp_raises_only_the_short_axis() {
        assert_eq!(clamp_logical_size(100.0, 900.0), (MIN_WINDOW_WIDTH, 900.0));
        assert_eq!(
            clamp_logical_size(1200.0, 100.0),
            (1200.0, MIN_WINDOW_HEIGHT)
        );
    }
}
