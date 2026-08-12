// ── SSH config I/O ──────────────────────────────────────────────────
// Rust only reads/writes raw text. All parsing is done in the frontend.

pub(crate) fn ssh_config_path() -> Option<std::path::PathBuf> {
    #[cfg(target_os = "windows")]
    {
        std::env::var("USERPROFILE")
            .ok()
            .map(|p| std::path::PathBuf::from(p).join(".ssh").join("config"))
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::env::var("HOME")
            .ok()
            .map(|p| std::path::PathBuf::from(p).join(".ssh").join("config"))
    }
}

#[tauri::command]
pub fn ssh_read_config_raw() -> Result<String, String> {
    let config_path = ssh_config_path().ok_or("Cannot determine home directory")?;
    if !config_path.exists() {
        return Ok(String::new());
    }
    std::fs::read_to_string(&config_path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn open_ssh_config() -> Result<(), String> {
    let path = ssh_config_path().ok_or("Cannot determine home directory")?;
    let path_str = path.to_string_lossy().to_string();
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("notepad")
            .arg(&path_str)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::process::Command::new("open")
            .arg(&path_str)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn ssh_clear_known_hosts(hostname: String) -> Result<String, String> {
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
pub fn ssh_save_config(content: String) -> Result<String, String> {
    let config_path = ssh_config_path().ok_or("Cannot determine SSH config path")?;
    if config_path.exists() {
        let backup = config_path.with_file_name(format!(
            "{}.tt.bak",
            config_path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
        ));
        std::fs::copy(&config_path, &backup).map_err(|e| format!("Failed to backup: {}", e))?;
    }
    std::fs::write(&config_path, &content).map_err(|e| e.to_string())?;
    Ok("SSH config saved. Original backed up to config.tt.bak".into())
}
