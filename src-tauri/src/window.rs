use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

// Must match tauri.conf.json `app.windows[0].minWidth` / `minHeight`
// (logical px). window-state restore uses PhysicalSize via SetWindowPos,
// which bypasses WM_GETMINMAXINFO — a corrupt or DPI-mismatched
// `.window-state.json` can therefore land below this floor.
pub(crate) const MIN_WINDOW_WIDTH: f64 = 800.0;
pub(crate) const MIN_WINDOW_HEIGHT: f64 = 600.0;

/// 1/φ (φ = (1+√5)/2). First-launch default = screen × this factor.
const GOLDEN_RATIO_INV: f64 = 0.618_033_988_749_894_8;

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

/// Default window size on first launch: each axis is the monitor size times
/// 1/φ (≈61.8%), then raised to the min floor.
pub(crate) fn golden_default_size(screen_w: f64, screen_h: f64) -> (f64, f64) {
    clamp_logical_size(screen_w * GOLDEN_RATIO_INV, screen_h * GOLDEN_RATIO_INV)
}

/// True when `.window-state.json` already has a usable saved size (returning
/// user). Missing / empty / zero-size entries mean first launch.
pub(crate) fn has_saved_window_geometry(app: &tauri::AppHandle) -> bool {
    let Ok(dir) = app.path().app_config_dir() else {
        return false;
    };
    let path = dir.join(tauri_plugin_window_state::DEFAULT_FILENAME);
    let Ok(bytes) = std::fs::read(path) else {
        return false;
    };
    let Ok(value) = serde_json::from_slice::<serde_json::Value>(&bytes) else {
        return false;
    };
    let Some(map) = value.as_object() else {
        return false;
    };
    map.values().any(|win| {
        let w = win.get("width").and_then(|v| v.as_u64()).unwrap_or(0);
        let h = win.get("height").and_then(|v| v.as_u64()).unwrap_or(0);
        w > 0 && h > 0
    })
}

/// First launch only: size the window to screen×(1/φ) and center it on the
/// current (or primary) monitor. No-op when maximized / fullscreen / minimized.
pub(crate) fn apply_golden_default_size(window: &tauri::WebviewWindow) {
    if window.is_minimized().unwrap_or(false)
        || window.is_maximized().unwrap_or(false)
        || window.is_fullscreen().unwrap_or(false)
    {
        return;
    }
    let monitor = match window.current_monitor() {
        Ok(Some(m)) => m,
        _ => match window.primary_monitor() {
            Ok(Some(m)) => m,
            _ => return,
        },
    };
    let scale = monitor.scale_factor();
    if !(scale.is_finite() && scale > 0.0) {
        return;
    }
    let tauri::PhysicalSize {
        width: sw,
        height: sh,
    } = *monitor.size();
    let tauri::PhysicalPosition { x: mx, y: my } = *monitor.position();
    if sw == 0 || sh == 0 {
        return;
    }
    let (w, h) = golden_default_size(f64::from(sw) / scale, f64::from(sh) / scale);
    let _ = window.set_size(tauri::LogicalSize::new(w, h));
    let px_w = (w * scale).round() as i32;
    let px_h = (h * scale).round() as i32;
    let x = mx + (sw as i32 - px_w) / 2;
    let y = my + (sh as i32 - px_h) / 2;
    let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
}

// Re-assert min_size and bump inner size up if restore/DPI put us under
// the floor. Call once after window-state restore — never from every
// Resized handler (set_min_size/set_size mid-maximize fights WS_MAXIMIZE
// on undecorated Windows). Skip maximized/fullscreen/minimized.
pub(crate) fn enforce_min_size(window: &tauri::WebviewWindow) {
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

/// One-shot flag: set when the frontend's confirm flow approves a close.
/// The close-requested hook checks and clears it, letting exactly that
/// close through while every unconfirmed request is prevented.
static CLOSE_CONFIRMED: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

pub fn take_close_confirmed() -> bool {
    CLOSE_CONFIRMED.swap(false, std::sync::atomic::Ordering::SeqCst)
}

/// Confirmed close: the frontend's confirm flow re-issues this after
/// approval — the flag lets exactly one close through the hook.
#[tauri::command]
pub fn window_close(window: tauri::Window) {
    CLOSE_CONFIRMED.store(true, std::sync::atomic::Ordering::SeqCst);
    let _ = window.close();
}

/// UNCONFIRMED close attempt (the X button): goes through the
/// close-requested hook like Alt+F4, so the frontend confirm decides.
#[tauri::command]
pub fn window_request_close(window: tauri::Window) {
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

    #[test]
    fn golden_default_is_screen_times_inv_phi() {
        let (w, h) = golden_default_size(1920.0, 1080.0);
        assert!((w - 1920.0 * GOLDEN_RATIO_INV).abs() < 0.01);
        assert!((h - 1080.0 * GOLDEN_RATIO_INV).abs() < 0.01);
        assert!(w >= MIN_WINDOW_WIDTH && h >= MIN_WINDOW_HEIGHT);
    }

    #[test]
    fn golden_default_respects_min_on_tiny_screens() {
        let (w, h) = golden_default_size(800.0, 600.0);
        assert_eq!((w, h), (MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT));
    }
}
