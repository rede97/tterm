//! System tray with a single shared icon for ALL TTerm windows.
//!
//! TTerm's "new window" spawns a new PROCESS, so one tray icon listing every
//! window needs cross-process coordination. There is no IPC server: state
//! lives in two files under the app config dir, and cross-process window
//! restore uses plain Win32 (EnumWindows by pid → ShowWindow) — the target
//! process does not need to cooperate.
//!
//! - `tray-windows.json` — registry of HIDDEN windows: [{pid, title}].
//!   A process appends its entry when its window retreats to the tray
//!   (close-to-tray intercept); the owner removes entries on restore,
//!   process death, or the window becoming visible again.
//! - `tray-owner.lock` — owner election by atomic create; contents are the
//!   owner pid. The owner keeps the tray icon and reconciles the registry
//!   every 2 s. A dead owner pid is replaced by the next process that hides
//!   its window.
//!
//! All registry mutations go through an advisory `tray.lock` sidecar
//! (create_new + retry) — human-scale events, so a spin retry is plenty.

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct TrayWindowEntry {
    pub pid: u32,
    pub title: String,
    // Unix seconds when the window hid. Reconcile gives fresh entries a
    // grace period before trusting Win32 visibility: Tauri's hide() is
    // dispatched to the main thread, so a just-hidden window can still read
    // as visible for a few hundred ms.
    #[serde(default)]
    pub since: u64,
}

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

// Last title reported by the frontend (active tab label) — the menu text
// when this window hides.
static LAST_TITLE: Mutex<Option<String>> = Mutex::new(None);

// The tray icon when this process is the owner. Dropping removes the icon.
static TRAY_ICON: Mutex<Option<tauri::tray::TrayIcon>> = Mutex::new(None);

// ---- paths ----

fn registry_path(base: &Path) -> PathBuf {
    base.join("tray-windows.json")
}

fn owner_path(base: &Path) -> PathBuf {
    base.join("tray-owner.lock")
}

fn config_base(app: &tauri::AppHandle) -> Option<PathBuf> {
    use tauri::Manager;
    app.path().app_config_dir().ok()
}

// ---- config ----

// The toggle lives in the frontend-owned config.json; the backend reads it
// on demand (window close is rare, so no sync channel is needed).
pub(crate) fn close_to_tray_enabled(app: &tauri::AppHandle) -> bool {
    let Some(base) = config_base(app) else { return false };
    parse_close_to_tray(&std::fs::read_to_string(base.join("config.json")).unwrap_or_default())
}

pub(crate) fn parse_close_to_tray(config_json: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(config_json)
        .ok()
        .and_then(|v| v.get("closeToTray").and_then(|b| b.as_bool()))
        .unwrap_or(false)
}

// ---- process liveness ----

#[cfg(windows)]
pub(crate) fn pid_alive(pid: u32) -> bool {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};
    unsafe {
        match OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) {
            Ok(h) => {
                let _ = CloseHandle(h);
                true
            }
            Err(_) => false,
        }
    }
}

#[cfg(not(windows))]
pub(crate) fn pid_alive(pid: u32) -> bool {
    Path::new(&format!("/proc/{}", pid)).exists()
}

// ---- registry I/O (lock-protected read-modify-write) ----

fn with_registry_lock<R>(base: &Path, f: impl FnOnce(&Path) -> R) -> R {
    let lock = base.join("tray.lock");
    let mut attempts = 0;
    loop {
        match std::fs::OpenOptions::new().write(true).create_new(true).open(&lock) {
            Ok(_) => break,
            Err(_) if attempts < 40 => {
                attempts += 1;
                std::thread::sleep(std::time::Duration::from_millis(25));
            }
            // A crashed holder leaves the file behind; after 1 s just take it.
            Err(_) => {
                let _ = std::fs::remove_file(&lock);
            }
        }
    }
    let out = f(base);
    let _ = std::fs::remove_file(&lock);
    out
}

pub(crate) fn list_hidden(base: &Path) -> Vec<TrayWindowEntry> {
    std::fs::read_to_string(registry_path(base))
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

fn write_hidden(base: &Path, entries: &[TrayWindowEntry]) {
    if let Ok(raw) = serde_json::to_string_pretty(entries) {
        let _ = std::fs::write(registry_path(base), raw);
    }
}

// Record (or refresh) this process's hidden window. Called on the
// close-to-tray intercept.
pub(crate) fn mark_hidden(base: &Path, pid: u32, title: String) {
    with_registry_lock(base, |base| {
        let mut entries = list_hidden(base);
        entries.retain(|e| e.pid != pid);
        entries.push(TrayWindowEntry { pid, title, since: now_secs() });
        write_hidden(base, &entries);
    });
}

pub(crate) fn unmark(base: &Path, pid: u32) {
    with_registry_lock(base, |base| {
        let entries = list_hidden(base);
        let kept: Vec<_> = entries.iter().filter(|e| e.pid != pid).cloned().collect();
        if kept.len() != entries.len() {
            write_hidden(base, &kept);
        }
    });
}

// ---- owner election ----

// Ensure this process owns the tray lock. Returns true when this process
// holds it afterwards (already owner, just elected, or dead owner replaced).
fn ensure_owner(base: &Path, pid: u32) -> bool {
    with_registry_lock(base, |base| {
        let lock = owner_path(base);
        if let Ok(raw) = std::fs::read_to_string(&lock) {
            if let Ok(owner_pid) = raw.trim().parse::<u32>() {
                if pid_alive(owner_pid) {
                    return owner_pid == pid;
                }
            }
            // Dead or unreadable owner: take over.
            let _ = std::fs::remove_file(&lock);
        }
        match std::fs::OpenOptions::new().write(true).create_new(true).open(&lock) {
            Ok(mut f) => {
                use std::io::Write;
                let _ = write!(f, "{}", pid);
                true
            }
            Err(_) => false, // raced with another process; it owns now
        }
    })
}

fn release_owner(base: &Path, pid: u32) {
    with_registry_lock(base, |base| {
        if let Ok(raw) = std::fs::read_to_string(owner_path(base)) {
            if raw.trim().parse::<u32>().ok() == Some(pid) {
                let _ = std::fs::remove_file(owner_path(base));
            }
        }
    });
}

// ---- cross-process window lookup (Win32) ----

// The main window of `pid`, identified by class: a TTerm process owns
// several top-level windows (ConPTY pseudoconsole, tao event target, IME,
// tray helper) that stay visible even when the real window is hidden, so
// matching by pid alone finds the wrong one. Tao windows use the
// "Tauri Window" class.
#[cfg(windows)]
fn hwnd_of_pid(pid: u32) -> Option<windows::Win32::Foundation::HWND> {
    use windows::core::BOOL;
    use windows::Win32::Foundation::{HWND, LPARAM};
    use windows::Win32::UI::WindowsAndMessaging::{EnumWindows, GetClassNameW, GetWindowThreadProcessId};

    struct Ctx {
        want: u32,
        found: Option<HWND>,
    }
    extern "system" fn cb(hwnd: HWND, param: LPARAM) -> BOOL {
        let ctx = unsafe { &mut *(param.0 as *mut Ctx) };
        let mut wp = 0u32;
        unsafe { GetWindowThreadProcessId(hwnd, Some(&mut wp)) };
        if wp == ctx.want {
            let mut buf = [0u16; 64];
            let n = unsafe { GetClassNameW(hwnd, &mut buf) };
            let class = String::from_utf16_lossy(&buf[..n as usize]);
            if class == "Tauri Window" {
                ctx.found = Some(hwnd);
                return BOOL(0); // stop enumeration
            }
        }
        BOOL(1)
    }

    let mut ctx = Ctx { want: pid, found: None };
    unsafe {
        let _ = EnumWindows(Some(cb), LPARAM(&mut ctx as *mut Ctx as isize));
    }
    ctx.found
}

#[cfg(windows)]
fn show_window_by_pid(pid: u32) -> bool {
    use windows::Win32::UI::WindowsAndMessaging::{
        IsIconic, SetForegroundWindow, ShowWindow, SW_RESTORE, SW_SHOW,
    };
    let Some(hwnd) = hwnd_of_pid(pid) else { return false };
    unsafe {
        if IsIconic(hwnd).as_bool() {
            let _ = ShowWindow(hwnd, SW_RESTORE);
        } else {
            let _ = ShowWindow(hwnd, SW_SHOW);
        }
        // May be rejected by the foreground lock when another app is active —
        // the window is shown regardless, which is the important part.
        let _ = SetForegroundWindow(hwnd);
    }
    true
}

#[cfg(not(windows))]
fn show_window_by_pid(_pid: u32) -> bool {
    false
}

#[cfg(windows)]
fn window_visible(pid: u32) -> bool {
    use windows::Win32::UI::WindowsAndMessaging::IsWindowVisible;
    hwnd_of_pid(pid).is_some_and(|hwnd| unsafe { IsWindowVisible(hwnd) }.as_bool())
}

#[cfg(not(windows))]
fn window_visible(_pid: u32) -> bool {
    false
}

// ---- tray icon (owner side) ----

const ITEM_SHOW_PREFIX: &str = "show:";
const ITEM_QUIT: &str = "tray:quit";

fn build_menu(app: &tauri::AppHandle, entries: &[TrayWindowEntry]) -> tauri::menu::Menu<tauri::Wry> {
    let mut builder = tauri::menu::MenuBuilder::new(app);
    for e in entries {
        let label = if e.title.is_empty() { format!("TTerm (pid {})", e.pid) } else { e.title.clone() };
        let item = tauri::menu::MenuItemBuilder::new(label)
            .id(format!("{}{}", ITEM_SHOW_PREFIX, e.pid))
            .build(app)
            .expect("tray menu item");
        builder = builder.item(&item);
    }
    if !entries.is_empty() {
        builder = builder.separator();
    }
    let quit = tauri::menu::MenuItemBuilder::new("Quit TTerm")
        .id(ITEM_QUIT)
        .build(app)
        .expect("tray menu item");
    builder
        .item(&quit)
        .build()
        .expect("tray menu")
}

fn on_menu_event(app: &tauri::AppHandle, id: &str) {
    let Some(base) = config_base(app) else { return };
    if let Some(pid_raw) = id.strip_prefix(ITEM_SHOW_PREFIX) {
        if let Ok(pid) = pid_raw.parse::<u32>() {
            restore_window(app, pid);
        }
    } else if id == ITEM_QUIT {
        // Quit = terminate every process currently parked in the tray
        // (shells inside them die — same as closing the app normally).
        for e in list_hidden(&base) {
            if e.pid != std::process::id() {
                terminate_pid(e.pid);
            }
        }
        app.exit(0);
    }
}

#[cfg(windows)]
fn terminate_pid(pid: u32) {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{OpenProcess, TerminateProcess, PROCESS_TERMINATE};
    unsafe {
        if let Ok(h) = OpenProcess(PROCESS_TERMINATE, false, pid) {
            let _ = TerminateProcess(h, 0);
            let _ = CloseHandle(h);
        }
    }
}

#[cfg(not(windows))]
fn terminate_pid(_pid: u32) {}

// Restore one hidden window (any process) and drop its registry entry.
fn restore_window(app: &tauri::AppHandle, pid: u32) {
    use tauri::Manager;
    let Some(base) = config_base(app) else { return };
    if pid == std::process::id() {
        for w in app.webview_windows().values() {
            let _ = w.show();
            let _ = w.unminimize();
            let _ = w.set_focus();
        }
    } else {
        show_window_by_pid(pid);
    }
    unmark(&base, pid);
    reconcile(app);
}

// Owner reconciliation: drop dead pids and windows that became visible
// again, refresh the menu, and tear the tray down when nothing is parked.
fn reconcile(app: &tauri::AppHandle) {
    let Some(base) = config_base(app) else { return };
    let now = now_secs();
    let entries = with_registry_lock(&base, |base| {
        let kept: Vec<_> = list_hidden(&base)
            .into_iter()
            .filter(|e| {
                if !pid_alive(e.pid) {
                    return false;
                }
                // Fresh entries get a grace period: hide() may not have
                // landed yet, so a visible reading is not yet trustworthy.
                !window_visible(e.pid) || now.saturating_sub(e.since) < 5
            })
            .collect();
        write_hidden(base, &kept);
        kept
    });
    let icon = {
        let slot = TRAY_ICON.lock();
        slot.as_ref().cloned()
    };
    if let Some(icon) = icon {
        if entries.is_empty() {
            TRAY_ICON.lock().take(); // drop removes the icon
            release_owner(&base, std::process::id());
        } else {
            let _ = icon.set_menu(Some(build_menu(app, &entries)));
        }
    }
}

// Create the tray icon + reconciliation poll. Called once ownership is taken.
fn spawn_tray(app: &tauri::AppHandle) {
    {
        let mut slot = TRAY_ICON.lock();
        if slot.is_some() {
            return;
        }
        let Some(base) = config_base(app) else { return };
        let entries = list_hidden(&base);
        let builder = tauri::tray::TrayIconBuilder::new()
            .tooltip("TTerm")
            .menu(&build_menu(app, &entries))
            .on_menu_event(|app, e| on_menu_event(app, e.id().as_ref()));
        let builder = match app.default_window_icon() {
            Some(icon) => builder.icon(icon.clone()),
            None => builder,
        };
        match builder.build(app) {
            Ok(icon) => *slot = Some(icon),
            Err(_) => return,
        }
    }
    // Slow poll: catches dead pids and windows shown by other means
    // (taskbar, Alt-Tab). Exits when the tray is torn down.
    let app2 = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
            if TRAY_ICON.lock().is_none() {
                break;
            }
            reconcile(&app2);
        }
    });
}

// ---- entry points called from lib.rs / commands ----

// Close-requested intercept: returns true when the close was converted into
// a tray hide (caller must prevent_close).
pub(crate) fn hide_to_tray(window: &tauri::Window) -> bool {
    use tauri::Manager;
    let app = window.app_handle();
    if !close_to_tray_enabled(app) {
        return false;
    }
    let Some(base) = config_base(app) else { return false };
    let pid = std::process::id();
    let title = LAST_TITLE.lock().clone().unwrap_or_else(|| "TTerm".into());
    let _ = window.hide();
    mark_hidden(&base, pid, title);
    if ensure_owner(&base, pid) {
        spawn_tray(app);
        reconcile(app);
    }
    true
}

// Process exit: drop our registry entry; if we owned the tray, release the
// lock so the next hiding process re-elects.
pub(crate) fn on_exit(app: &tauri::AppHandle) {
    let Some(base) = config_base(app) else { return };
    let pid = std::process::id();
    unmark(&base, pid);
    release_owner(&base, pid);
    TRAY_ICON.lock().take();
}

// Frontend reports the window title (active tab label, debounced).
#[tauri::command]
pub fn tray_set_title(window: tauri::Window, title: String) {
    let _ = window.set_title(&title);
    *LAST_TITLE.lock() = Some(title);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_base(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("tterm-tray-test-{}-{}", tag, std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn registry_add_update_remove() {
        let base = temp_base("crud");
        mark_hidden(&base, 100, "one".into());
        mark_hidden(&base, 200, "two".into());
        assert_eq!(list_hidden(&base).len(), 2);
        // Re-hiding the same pid refreshes the title instead of duplicating.
        mark_hidden(&base, 100, "one-renamed".into());
        let entries = list_hidden(&base);
        assert_eq!(entries.len(), 2);
        assert_eq!(entries.iter().find(|e| e.pid == 100).unwrap().title, "one-renamed");
        unmark(&base, 100);
        let entries = list_hidden(&base);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].pid, 200);
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn owner_election_and_dead_owner_takeover() {
        let base = temp_base("owner");
        let me = std::process::id();
        assert!(ensure_owner(&base, me));
        // A live owner (us) cannot be displaced by another pid.
        assert!(!ensure_owner(&base, me.wrapping_add(1)));
        // A dead owner (u32::MAX is never a live process) is replaced.
        std::fs::write(owner_path(&base), u32::MAX.to_string()).unwrap();
        assert!(ensure_owner(&base, me.wrapping_add(1)));
        release_owner(&base, me.wrapping_add(1));
        assert!(!owner_path(&base).exists());
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn pid_alive_sanity() {
        assert!(pid_alive(std::process::id()));
        assert!(!pid_alive(u32::MAX));
    }

    #[test]
    fn close_to_tray_config_parsing() {
        assert!(!parse_close_to_tray("{}"));
        assert!(!parse_close_to_tray("not json"));
        assert!(!parse_close_to_tray(r#"{"closeToTray":false}"#));
        assert!(parse_close_to_tray(r#"{"closeToTray":true}"#));
    }
}
