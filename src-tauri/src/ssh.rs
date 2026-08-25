// ── SSH config I/O ──────────────────────────────────────────────────
// Rust only reads/writes raw text. All parsing is done in the frontend.

use std::path::{Path, PathBuf};

pub(crate) fn ssh_config_path() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        std::env::var("USERPROFILE")
            .ok()
            .map(|p| PathBuf::from(p).join(".ssh").join("config"))
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::env::var("HOME")
            .ok()
            .map(|p| PathBuf::from(p).join(".ssh").join("config"))
    }
}

pub(crate) fn ssh_dir() -> Option<PathBuf> {
    ssh_config_path().and_then(|p| p.parent().map(|d| d.to_path_buf()))
}

// Fresh machines (and some CI images) have no ~/.ssh. OpenSSH and our
// config write both require the directory; create it rather than failing
// the whole Settings save. Unix mode 0700 matches ssh-keygen.
pub(crate) fn ensure_ssh_dir_at(dir: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("Failed to create {}: {e}", dir.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700))
            .map_err(|e| format!("Failed to chmod 700 {}: {e}", dir.display()))?;
    }
    Ok(())
}

fn ensure_parent_ssh_dir(path: &Path) -> Result<(), String> {
    match path.parent() {
        Some(dir) if !dir.as_os_str().is_empty() => ensure_ssh_dir_at(dir),
        _ => Ok(()),
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
    ensure_parent_ssh_dir(&path)?;
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
    write_ssh_config_file(&config_path, &content)?;
    Ok("SSH config saved. Original backed up to config.tt.bak".into())
}

fn write_ssh_config_file(config_path: &Path, content: &str) -> Result<(), String> {
    ensure_parent_ssh_dir(config_path)?;
    if config_path.exists() {
        let backup = config_path.with_file_name(format!(
            "{}.tt.bak",
            config_path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
        ));
        std::fs::copy(config_path, &backup).map_err(|e| format!("Failed to backup: {}", e))?;
    }
    std::fs::write(config_path, content).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_ssh_dir() -> PathBuf {
        let n = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("tterm-ssh-dir-test-{n}"))
    }

    #[test]
    fn write_config_creates_missing_ssh_dir() {
        let dir = temp_ssh_dir();
        let path = dir.join("config");
        assert!(!dir.exists(), "precondition: no ~/.ssh equivalent");
        write_ssh_config_file(&path, "Host x\n").unwrap();
        assert!(dir.is_dir());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "Host x\n");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn write_config_backs_up_existing_file() {
        let dir = temp_ssh_dir();
        let path = dir.join("config");
        write_ssh_config_file(&path, "Host old\n").unwrap();
        write_ssh_config_file(&path, "Host new\n").unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "Host new\n");
        assert_eq!(
            std::fs::read_to_string(dir.join("config.tt.bak")).unwrap(),
            "Host old\n"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }
}
