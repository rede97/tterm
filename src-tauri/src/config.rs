use tauri::Manager;

#[tauri::command]
pub fn read_config(app: tauri::AppHandle) -> String {
    let config_dir = app.path().app_config_dir().unwrap_or_default();
    let file = config_dir.join("config.json");
    std::fs::read_to_string(file).unwrap_or_else(|_| "{}".into())
}

#[tauri::command]
pub fn write_config(app: tauri::AppHandle, content: String) -> Result<(), String> {
    let config_dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&config_dir).map_err(|e| e.to_string())?;
    std::fs::write(config_dir.join("config.json"), &content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_config(app: tauri::AppHandle) -> Result<(), String> {
    let config_dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    let file = config_dir.join("config.json");
    if file.exists() {
        std::fs::remove_file(&file).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn open_config_dir(app: tauri::AppHandle) -> Result<(), String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    #[cfg(target_os = "windows")]
    { std::process::Command::new("explorer").arg(&dir).spawn().map_err(|e| e.to_string())?; }
    #[cfg(not(target_os = "windows"))]
    { std::process::Command::new("open").arg(&dir).spawn().map_err(|e| e.to_string())?; }
    Ok(())
}
