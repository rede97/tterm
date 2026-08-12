use tauri::Manager;

// All app config lives in per-topic JSON files under the app config dir
// (config.json / themes.json / serial-profiles.json / keybindings.json —
// the last is VS Code's keybindings.json parity).
//
// Rust does RAW I/O only — parsing, merging, validation, and migration are
// all frontend concerns. The whitelist keeps this from becoming an
// arbitrary-file read/write primitive.
const CONFIG_FILES: [&str; 4] = ["config", "themes", "serial-profiles", "keybindings"];

fn config_path(app: &tauri::AppHandle, name: &str) -> Result<std::path::PathBuf, String> {
    if !CONFIG_FILES.contains(&name) {
        return Err(format!("unknown config file: {name}"));
    }
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    Ok(dir.join(format!("{name}.json")))
}

#[tauri::command]
pub fn read_config_file(app: tauri::AppHandle, name: &str) -> Result<String, String> {
    let file = config_path(&app, name)?;
    Ok(std::fs::read_to_string(file).unwrap_or_else(|_| "{}".into()))
}

#[tauri::command]
pub fn write_config_file(app: tauri::AppHandle, name: &str, content: String) -> Result<(), String> {
    let file = config_path(&app, name)?;
    if let Some(dir) = file.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(file, content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_config_file(app: tauri::AppHandle, name: &str) -> Result<(), String> {
    let file = config_path(&app, name)?;
    if file.exists() {
        std::fs::remove_file(file).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn open_config_dir(app: tauri::AppHandle) -> Result<(), String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::process::Command::new("open")
            .arg(&dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}
