use portable_pty::{native_pty_system, CommandBuilder, PtySize, MasterPty};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Mutex;
use tauri::{Emitter, Manager};
use tauri_plugin_dialog::DialogExt;

#[cfg(target_os = "windows")]
extern "system" {
    fn ShellExecuteW(
        hwnd: isize,
        lpOperation: *const u16,
        lpFile: *const u16,
        lpParameters: *const u16,
        lpDirectory: *const u16,
        nShowCmd: i32,
    ) -> isize;
}

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
fn pty_spawn(state: tauri::State<AppState>, app: tauri::AppHandle, command: Option<String>) -> Result<String, String> {
    let mut next = state.next_id.lock().map_err(|e| e.to_string())?;
    let id = format!("tab-{}", *next);
    *next += 1;
    drop(next);

    if let Some(cmd) = command {
        if !cmd.is_empty() {
            let (exe, args) = parse_command(&cmd);
            if args.is_empty() {
                spawn_pty(app, id.clone(), CommandBuilder::new(&exe))?;
            } else {
                let mut builder = CommandBuilder::new(&exe);
                for a in &args { builder.arg(a); }
                spawn_pty(app, id.clone(), builder)?;
            }
            return Ok(id);
        }
    }

    let shell = get_shell();
    spawn_pty(app, id.clone(), CommandBuilder::new(&shell))?;
    Ok(id)
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
        let vswhere = r"C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe";
        let output = match std::process::Command::new(vswhere)
            .args(["-format", "json", "-products", "*", "-requires", "Microsoft.VisualStudio.Component.VC.Tools.x86.x64"])
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
    let r = try_vswhere();
    if !r.is_empty() { return r; }
    try_common_vs_paths()
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

#[tauri::command]
fn read_wt_settings() -> Option<String> {
    load_wt_settings_raw()
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

#[tauri::command]
fn pty_spawn_elevated(state: tauri::State<AppState>, app: tauri::AppHandle, command: Option<String>) -> Result<String, String> {
    let cmd_str = command.clone().filter(|s| !s.is_empty()).unwrap_or_else(get_shell);

    #[cfg(target_os = "windows")]
    {
        // Launch elevated process via ShellExecuteW with "runas" verb → UAC prompt → new console window
        use std::ffi::OsStr;
        use std::os::windows::ffi::OsStrExt;

        let op: Vec<u16> = OsStr::new("runas\0").encode_wide().collect();

        let mut file: Vec<u16> = OsStr::new(&cmd_str).encode_wide().collect();
        file.push(0); // null terminate for ShellExecuteW

        let ret = unsafe { ShellExecuteW(0, op.as_ptr(), file.as_ptr(), std::ptr::null(), std::ptr::null(), 1) };
        if ret as i32 <= 32 {
            eprintln!("ShellExecuteW failed with code {}", ret);
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        // Unix: sudo within PTY
        let mut builder = CommandBuilder::new("sudo");
        builder.arg(&cmd_str);
        let mut next = state.next_id.lock().map_err(|e| e.to_string())?;
        let id = format!("tab-{}", *next);
        *next += 1;
        drop(next);
        spawn_pty(app, id.clone(), builder)?;
        return Ok(id);
    }

    // On Windows: create a normal (non-elevated) tab so the user gets a usable shell
    // The elevated terminal runs in its own console window
    let mut next = state.next_id.lock().map_err(|e| e.to_string())?;
    let id = format!("tab-{}", *next);
    *next += 1;
    drop(next);
    spawn_pty(app, id.clone(), CommandBuilder::new(&cmd_str))?;
    Ok(id)
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
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![pty_spawn, pty_spawn_ssh, pty_spawn_elevated, save_text_file, pty_write, pty_resize, pty_kill, window_minimize, window_toggle_maximize, window_close, window_start_drag, ssh_list_hosts, read_wt_settings, find_vs_instances, read_config, write_config])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
