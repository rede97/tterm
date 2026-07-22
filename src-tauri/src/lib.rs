use portable_pty::{native_pty_system, CommandBuilder, PtySize, MasterPty};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;
use futures_util::{SinkExt, StreamExt};
use tokio_tungstenite::accept_async;
use tokio_tungstenite::tungstenite::Message as WsMessage;

#[derive(Clone, Serialize)]
pub(crate) struct WsConnectResult {
    pub(crate) id: String,
    pub(crate) port: u16,
}

pub(crate) struct PtySession {
    pub(crate) master: Box<dyn MasterPty + Send>,
}

pub(crate) struct AppState {
    pub(crate) sessions: Mutex<HashMap<String, PtySession>>,
    pub(crate) next_id: Mutex<u32>,
    pub(crate) initial_cwd: Option<PathBuf>,
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

fn spawn_pty(app_handle: tauri::AppHandle, id: String, cmd: CommandBuilder) -> Result<u16, String> {
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
    let writer: Box<dyn Write + Send> = master.take_writer().map_err(|e| e.to_string())?;

    // Bind WebSocket server on random port
    let listener = std::net::TcpListener::bind("127.0.0.1:0")
        .map_err(|e| format!("Failed to bind local WS: {}", e))?;
    listener.set_nonblocking(true)
        .map_err(|e| format!("set_nonblocking: {}", e))?;
    let port = listener.local_addr()
        .map_err(|e| format!("Failed to get port: {}", e))?.port();

    let rt = tauri::async_runtime::handle();
    // NFC: rt.spawn consumes `rt`, clone for reuse
    rt.clone().spawn(async move {
        let stream = match tokio::net::TcpListener::from_std(listener) {
            Ok(tl) => match tl.accept().await {
                Ok((s, _)) => s,
                Err(_) => return,
            },
            Err(_) => return,
        };
        let ws = match accept_async(stream).await {
            Ok(ws) => ws,
            Err(_) => return,
        };
        let (mut ws_sink, mut ws_stream) = ws.split();

        // Channel: PTY reader → WS (unidirectional, no Mutex)
        let (tx, mut rx) = tokio::sync::mpsc::channel::<Vec<u8>>(256);

        // Task 1: PTY read (blocking) → channel
        let tx1 = tx.clone();
        rt.spawn(async move {
            let _ = tokio::task::spawn_blocking(move || {
                let mut buf = [0u8; 16384];
                loop {
                    match reader.read(&mut buf) {
                        Ok(0) => break,
                        Ok(n) => {
                            if tx1.blocking_send(buf[..n].to_vec()).is_err() { break; }
                        }
                        Err(_) => break,
                    }
                }
            }).await;
        });

        // Task 2: channel → WS sink (fully async)
        rt.spawn(async move {
            while let Some(data) = rx.recv().await {
                if ws_sink.send(WsMessage::Binary(data)).await.is_err() { break; }
            }
        });

        // Task 3: WS stream → PTY write
        // writer is Arc<Mutex<>> so it can be shared across spawn_blocking calls
        let pty_w = Arc::new(Mutex::new(writer));
        rt.spawn(async move {
            while let Some(Ok(msg)) = ws_stream.next().await {
                let data = match msg {
                    WsMessage::Binary(d) => d,
                    WsMessage::Text(t) => t.into_bytes(),
                    WsMessage::Close(_) => break,
                    _ => continue,
                };
                let w = pty_w.clone();
                let result = tokio::task::spawn_blocking(move || {
                    let mut guard = match w.lock() { Ok(g) => g, Err(_) => return };
                    if guard.write_all(&data).is_err() { return; }
                    let _ = guard.flush();
                }).await;
                if result.is_err() { break; }
            }
        });
    });

    // Store session (master for resize)
    let sessions = app_handle.state::<AppState>();
    sessions.sessions.lock().map_err(|e| e.to_string())?.insert(
        id,
        PtySession { master },
    );

    Ok(port)
}

fn apply_initial_cwd(cmd: &mut CommandBuilder, cwd: Option<&PathBuf>) {
    if let Some(cwd) = cwd {
        if cwd.is_dir() {
            cmd.cwd(cwd);
        }
    }
}

#[tauri::command]
fn pty_spawn(state: tauri::State<AppState>, app: tauri::AppHandle, command: Option<String>) -> Result<WsConnectResult, String> {
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

fn launch_working_directory() -> Option<PathBuf> {
    parse_working_dir(std::env::args_os().skip(1))
}

fn parse_working_dir<I: Iterator<Item = std::ffi::OsString>>(mut args: I) -> Option<PathBuf> {
    while let Some(arg) = args.next() {
        if arg == "--working-directory" {
            return args.next().map(PathBuf::from).filter(|path| path.is_dir());
        }
    }
    None
}

fn expand_env_str(s: &str) -> String {
    let mut out = String::new();
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '%' {
            let mut var = String::new();
            for next in chars.by_ref() {
                if next == '%' { break; }
                var.push(next);
            }
            match std::env::var(&var) {
                Ok(v) => out.push_str(&v),
                Err(_) => { out.push('%'); out.push_str(&var); out.push('%'); }
            }
        } else {
            out.push(c);
        }
    }
    out
}

fn parse_command(cmd_str: &str) -> (String, Vec<String>) {
    let mut tokens: Vec<String> = Vec::new();
    let mut cur = String::new();
    let mut in_quote = false;
    for c in cmd_str.chars() {
        match c {
            '"' => in_quote = !in_quote,
            ' ' if !in_quote => {
                if !cur.is_empty() { tokens.push(cur.clone()); cur.clear(); }
            }
            _ => cur.push(c),
        }
    }
    if !cur.is_empty() { tokens.push(cur); }

    if tokens.is_empty() { return (cmd_str.to_string(), Vec::new()); }

    let expanded: Vec<String> = tokens.into_iter().map(|t| expand_env_str(&t)).collect();
    let mut i = expanded.into_iter();
    let exe = i.next().unwrap();
    let args: Vec<String> = i.collect();
    (exe, args)
}

// ── Windows Terminal settings loader + VS instance discovery ────────

#[derive(Clone, Serialize, Debug)]
struct VsInstallation {
    path: String,
    version: String,
    instance_id: Option<String>,
}

fn try_vswhere() -> Vec<VsInstallation> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let vswhere = r"C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe";
        let output = match std::process::Command::new(vswhere)
            .args(["-format", "json", "-products", "*", "-requires", "Microsoft.VisualStudio.Component.VC.Tools.x86.x64"])
            .creation_flags(0x08000000) // CREATE_NO_WINDOW
            .output()
        {
            Ok(o) if o.status.success() => o,
            _ => return vec![],
        };
        let text = String::from_utf8_lossy(&output.stdout);
        let instances: Vec<serde_json::Value> = match serde_json::from_str(&text) {
            Ok(v) => v,
            _ => return vec![],
        };
        instances.into_iter().filter_map(|inst| {
            let path = inst["installationPath"].as_str()?.to_string();
            let version = inst["installationVersion"].as_str()?.to_string();
            let instance_id = inst["instanceId"].as_str().map(|s| s.to_string());
            Some(VsInstallation { path, version, instance_id })
        }).collect()
    }
    #[cfg(not(target_os = "windows"))]
    { vec![] }
}

fn try_common_vs_paths() -> Vec<VsInstallation> {
    let mut result = vec![];
    let roots = [
        r"C:\Program Files\Microsoft Visual Studio",
        r"C:\Program Files (x86)\Microsoft Visual Studio",
    ];
    for root in &roots {
        for year in &["2024", "2022", "2019"] {
            for edition in &["Community", "Professional", "Enterprise", "BuildTools"] {
                let path = format!(r"{root}\{year}\{edition}");
                if std::path::Path::new(&format!(r"{path}\Common7\Tools\VsDevCmd.bat")).exists() {
                    result.push(VsInstallation { path, version: year.to_string(), instance_id: None });
                }
            }
        }
    }
    result
}

#[tauri::command]
fn find_vs_instances() -> Vec<VsInstallation> {
    // try vswhere first (CREATE_NO_WINDOW prevents console window / WT popup)
    let mut result = try_vswhere();
    // merge file-based results, filling gaps
    for vs in try_common_vs_paths() {
        if !result.iter().any(|r| r.path == vs.path) {
            result.push(vs);
        }
    }
    result
}

fn load_wt_settings_raw() -> Option<String> {
    #[cfg(target_os = "windows")]
    {
        let la = std::env::var("LOCALAPPDATA").ok()?;
        let paths = [
            format!("{}\\Packages\\Microsoft.WindowsTerminal_8wekyb3d8bbwe\\LocalState\\settings.json", la),
            format!("{}\\Packages\\Microsoft.WindowsTerminalPreview_8wekyb3d8bbwe\\LocalState\\settings.json", la),
            format!("{}\\Microsoft\\Windows Terminal\\settings.json", la),
        ];
        for p in &paths {
            let path = std::path::Path::new(p);
            if path.exists() {
                if let Ok(c) = std::fs::read_to_string(path) {
                    return Some(c);
                }
            }
        }
        None
    }
    #[cfg(not(target_os = "windows"))]
    { None }
}

fn load_wt_fragments() -> Vec<String> {
    #[cfg(target_os = "windows")]
    {
        let mut result = Vec::new();
        let la = match std::env::var("LOCALAPPDATA") { Ok(v) => v.clone() , Err(_) => return result };
        let pd = match std::env::var("ProgramData") { Ok(v) => v, Err(_) => return result };
        let frag_dirs = [
            format!("{}\\Packages\\Microsoft.WindowsTerminal_8wekyb3d8bbwe\\LocalState\\Fragments", la),
            format!("{}\\Packages\\Microsoft.WindowsTerminalPreview_8wekyb3d8bbwe\\LocalState\\Fragments", la),
            format!("{}\\Microsoft\\Windows Terminal\\Fragments", la),
            format!("{pd}\\Microsoft\\Windows Terminal\\Fragments"),
        ];
        for d in &frag_dirs {
            let dir = std::path::Path::new(d);
            if !dir.is_dir() { continue; }
            // fragments are in subdirectories (e.g. Git/git-bash.json)
            if let Ok(entries) = std::fs::read_dir(dir) {
                for entry in entries.flatten() {
                    let p = entry.path();
                    if p.is_dir() {
                        if let Ok(sub) = std::fs::read_dir(&p) {
                            for f in sub.flatten() {
                                let fp = f.path();
                                if fp.extension().map_or(false, |e| e == "json") {
                                    if let Ok(c) = std::fs::read_to_string(&fp) {
                                        result.push(c);
                                    }
                                }
                            }
                        }
                    } else if p.extension().map_or(false, |e| e == "json") {
                        if let Ok(c) = std::fs::read_to_string(&p) {
                            result.push(c);
                        }
                    }
                }
            }
        }
        result
    }
    #[cfg(not(target_os = "windows"))]
    { Vec::new() }
}

#[tauri::command]
fn read_wt_settings() -> Option<String> {
    load_wt_settings_raw()
}

#[tauri::command]
fn read_wt_fragments() -> Vec<String> {
    load_wt_fragments()
}

#[tauri::command]
fn read_config(app: tauri::AppHandle) -> String {
    let config_dir = app.path().app_config_dir().unwrap_or_default();
    let file = config_dir.join("config.json");
    std::fs::read_to_string(file).unwrap_or_else(|_| "{}".into())
}

#[tauri::command]
fn write_config(app: tauri::AppHandle, content: String) -> Result<(), String> {
    let config_dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&config_dir).map_err(|e| e.to_string())?;
    std::fs::write(config_dir.join("config.json"), &content).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_config(app: tauri::AppHandle) -> Result<(), String> {
    let config_dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    let file = config_dir.join("config.json");
    if file.exists() {
        std::fs::remove_file(&file).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn pty_spawn_ssh(state: tauri::State<AppState>, app: tauri::AppHandle, hostname: String, port: u16, user: String) -> Result<WsConnectResult, String> {
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
fn pty_resize(state: tauri::State<AppState>, id: &str, cols: u16, rows: u16) -> Result<(), String> {
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

#[tauri::command]
fn open_new_window() -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    std::process::Command::new(exe)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn save_text_file(app: tauri::AppHandle, content: String) -> Result<(), String> {
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

// ── SSH config I/O ──────────────────────────────────────────────────
// Rust only reads/writes raw text. All parsing is done in the frontend.

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

#[tauri::command]
fn ssh_read_config_raw() -> Result<String, String> {
    let config_path = ssh_config_path().ok_or("Cannot determine home directory")?;
    if !config_path.exists() {
        return Ok(String::new());
    }
    std::fs::read_to_string(&config_path).map_err(|e| e.to_string())
}

#[tauri::command]
fn open_config_dir(app: tauri::AppHandle) -> Result<(), String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    #[cfg(target_os = "windows")]
    { std::process::Command::new("explorer").arg(&dir).spawn().map_err(|e| e.to_string())?; }
    #[cfg(not(target_os = "windows"))]
    { std::process::Command::new("open").arg(&dir).spawn().map_err(|e| e.to_string())?; }
    Ok(())
}

#[tauri::command]
fn open_ssh_config() -> Result<(), String> {
    let path = ssh_config_path().ok_or("Cannot determine home directory")?;
    let path_str = path.to_string_lossy().to_string();
    #[cfg(target_os = "windows")]
    { std::process::Command::new("notepad").arg(&path_str).spawn().map_err(|e| e.to_string())?; }
    #[cfg(not(target_os = "windows"))]
    { std::process::Command::new("open").arg(&path_str).spawn().map_err(|e| e.to_string())?; }
    Ok(())
}

#[tauri::command]
fn ssh_clear_known_hosts(hostname: String) -> Result<String, String> {
    let output = std::process::Command::new("ssh-keygen")
        .args(["-R", &hostname])
        .output()
        .map_err(|e| format!("Failed to run ssh-keygen: {}", e))?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    if output.status.success() {
        Ok(format!("{}{}", stdout, stderr))
    } else {
        Err(stderr)
    }
}


#[tauri::command]
fn ssh_save_config(content: String) -> Result<String, String> {
    let config_path = ssh_config_path().ok_or("Cannot determine SSH config path")?;
    if config_path.exists() {
        let backup = config_path.with_extension("config.tt.bak");
        std::fs::copy(&config_path, &backup).map_err(|e| format!("Failed to backup: {}", e))?;
    }
    std::fs::write(&config_path, &content).map_err(|e| e.to_string())?;
    Ok("SSH config saved. Original backed up to config.tt.bak".into())
}

// -- Serial port enumeration ---

#[derive(Clone, Serialize)]
struct SerialPortInfo {
    name: String,
    driver: String,
    manufacturer: String,
    product: String,
    vid: String,
    pid: String,
}

#[tauri::command]
fn serial_list_ports() -> Vec<SerialPortInfo> {
    serial_enumerator::get_serial_list()
        .into_iter()
        .map(|p| {
            let (vid, pid) = p.usb_info.map_or((String::new(), String::new()), |u| (u.vid, u.pid));
            SerialPortInfo {
                name: p.name,
                driver: p.driver.unwrap_or_default(),
                manufacturer: p.vendor.unwrap_or_default(),
                product: p.product.unwrap_or_default(),
                vid,
                pid,
            }
        })
        .collect()
}

// -- System font enumeration ---

// Strip the registry font-name suffix, returning the family name.
// Returns None if the name has no known suffix.
fn strip_font_suffix(name: &str) -> Option<String> {
    for suffix in [" (TrueType)", " (OpenType)"] {
        if let Some(stripped) = name.strip_suffix(suffix) {
            return Some(stripped.to_string());
        }
    }
    None
}

#[tauri::command]
fn list_system_fonts() -> Vec<String> {
    use winreg::enums::*;
    use winreg::RegKey;
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let mut names: Vec<String> = Vec::new();
    if let Ok(key) = hklm.open_subkey(r"SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts") {
        for v in key.enum_values().filter_map(|r| r.ok()) {
            if let Some(family) = strip_font_suffix(&v.0) {
                names.push(family);
            }
        }
    }
    names.sort();
    names.dedup();
    names
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .setup(|app| {
            // verify PTY system is available
            let _pty_sys = native_pty_system();

            app.manage(AppState {
                sessions: Mutex::new(HashMap::new()),
                next_id: Mutex::new(1),
                initial_cwd: launch_working_directory(),
            });

            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![pty_spawn, pty_spawn_ssh, save_text_file, pty_resize, pty_kill, window_minimize, window_toggle_maximize, window_close, window_start_drag, open_new_window, ssh_read_config_raw, open_config_dir, open_ssh_config, ssh_clear_known_hosts, ssh_save_config, read_wt_settings, read_wt_fragments, find_vs_instances, read_config, write_config, delete_config, serial_list_ports, list_system_fonts])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

// ── Unit tests ──────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // -- parse_command --

    #[test]
    fn parse_command_simple() {
        let (exe, args) = parse_command("cmd.exe /c echo");
        assert_eq!(exe, "cmd.exe");
        assert_eq!(args, vec!["/c", "echo"]);
    }

    #[test]
    fn parse_command_quoted_path_with_spaces() {
        let (exe, args) = parse_command("\"C:\\Program Files\\app\\tool.exe\" -k \"arg with spaces\"");
        assert_eq!(exe, "C:\\Program Files\\app\\tool.exe");
        assert_eq!(args, vec!["-k", "arg with spaces"]);
    }

    #[test]
    fn parse_command_collapses_repeated_spaces() {
        let (exe, args) = parse_command("powershell.exe   -NoExit   -Command");
        assert_eq!(exe, "powershell.exe");
        assert_eq!(args, vec!["-NoExit", "-Command"]);
    }

    #[test]
    fn parse_command_no_args() {
        let (exe, args) = parse_command("wsl.exe");
        assert_eq!(exe, "wsl.exe");
        assert!(args.is_empty());
    }

    #[test]
    fn parse_command_empty_string_returns_input() {
        let (exe, args) = parse_command("");
        assert_eq!(exe, "");
        assert!(args.is_empty());
    }

    #[test]
    fn parse_command_unclosed_quote_consumes_rest() {
        let (exe, args) = parse_command("app.exe \"dangling quote");
        assert_eq!(exe, "app.exe");
        assert_eq!(args, vec!["dangling quote"]);
    }

    #[test]
    fn parse_command_expands_env_vars() {
        std::env::set_var("TTERM_TEST_TOOL", "mytool");
        let (exe, args) = parse_command("%TTERM_TEST_TOOL% --flag");
        assert_eq!(exe, "mytool");
        assert_eq!(args, vec!["--flag"]);
    }

    // -- expand_env_str --

    #[test]
    fn expand_env_existing_var() {
        std::env::set_var("TTERM_TEST_EXPAND", "expanded");
        assert_eq!(expand_env_str("%TTERM_TEST_EXPAND%"), "expanded");
    }

    #[test]
    fn expand_env_missing_var_kept_verbatim() {
        assert_eq!(expand_env_str("%TTERM_DEFINITELY_MISSING_VAR%"), "%TTERM_DEFINITELY_MISSING_VAR%");
    }

    #[test]
    fn expand_env_multiple_vars_and_literal_text() {
        std::env::set_var("TTERM_TEST_A", "foo");
        std::env::set_var("TTERM_TEST_B", "bar");
        assert_eq!(expand_env_str("pre-%TTERM_TEST_A%-mid-%TTERM_TEST_B%-post"), "pre-foo-mid-bar-post");
    }

    #[test]
    fn expand_env_no_percent_passthrough() {
        assert_eq!(expand_env_str("plain text"), "plain text");
    }

    // -- strip_font_suffix --

    #[test]
    fn strip_truetype_suffix() {
        assert_eq!(strip_font_suffix("Consolas (TrueType)"), Some("Consolas".to_string()));
    }

    #[test]
    fn strip_opentype_suffix() {
        assert_eq!(strip_font_suffix("Segoe UI (OpenType)"), Some("Segoe UI".to_string()));
    }

    #[test]
    fn strip_unknown_suffix_returns_none() {
        assert_eq!(strip_font_suffix("Some Font (Raster)"), None);
        assert_eq!(strip_font_suffix("Some Font"), None);
    }

    #[test]
    fn strip_suffix_only_at_end() {
        // " (TrueType)" in the middle must not be stripped
        assert_eq!(strip_font_suffix("Weird (TrueType) Font"), None);
    }

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
