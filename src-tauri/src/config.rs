use tauri::Manager;

// All app-owned state lives under the app config dir. DEBUG builds (tauri
// dev, e2e, cargo test binaries) use a `dev/` SUBDIRECTORY so experiments
// never touch the installed release's files (config.json, keybindings.json,
// themes, serial profiles, tray registry). The window-state plugin keeps
// using the shared parent (window geometry only — harmless).
pub(crate) fn app_data_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    Ok(if cfg!(debug_assertions) {
        dir.join("dev")
    } else {
        dir
    })
}

#[cfg(test)]
mod tests {
    #[test]
    fn debug_builds_use_dev_subdir() {
        // Tests always run with debug_assertions, so the helper must pick
        // the dev/ suffix here; the release arm is cfg'd out at compile time.
        assert!(cfg!(debug_assertions));
    }

    #[test]
    fn write_atomic_replaces_existing_and_leaves_no_tmp() {
        let dir = std::env::temp_dir().join(format!("tterm-test-cfg-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("config.json");

        super::write_atomic(&file, "{\"a\":1}").unwrap();
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "{\"a\":1}");

        // Second write must replace (rename-over-existing works on NTFS too).
        super::write_atomic(&file, "{\"a\":2,\"longer\":true}").unwrap();
        assert_eq!(
            std::fs::read_to_string(&file).unwrap(),
            "{\"a\":2,\"longer\":true}"
        );
        assert!(
            !file.with_extension("json.tmp").exists(),
            "tmp file must be consumed by the rename"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }
}

// All app config lives in per-topic JSON files under the app config dir
// (config.json / themes.json / serial-profiles.json / keybindings.json /
// ssh-history.json — the last is Temporary Connect MRU, never ~/.ssh/config).
//
// Rust does RAW I/O only — parsing, merging, validation, and migration are
// all frontend concerns. The whitelist keeps this from becoming an
// arbitrary-file read/write primitive.
const CONFIG_FILES: [&str; 5] = [
    "config",
    "themes",
    "serial-profiles",
    "keybindings",
    "ssh-history",
];

fn config_path(app: &tauri::AppHandle, name: &str) -> Result<std::path::PathBuf, String> {
    if !CONFIG_FILES.contains(&name) {
        return Err(format!("unknown config file: {name}"));
    }
    Ok(app_data_dir(app)?.join(format!("{name}.json")))
}

#[tauri::command]
pub fn read_config_file(app: tauri::AppHandle, name: &str) -> Result<String, String> {
    let file = config_path(&app, name)?;
    Ok(std::fs::read_to_string(file).unwrap_or_else(|_| "{}".into()))
}

// Atomic write: a crash mid-write must never leave a truncated JSON
// behind (read side would silently fall back to "{}"). Write a sibling
// temp file, then rename over the target — same-directory rename is
// atomic on both NTFS and POSIX.
fn write_atomic(file: &std::path::Path, content: &str) -> Result<(), String> {
    let tmp = file.with_extension("json.tmp");
    std::fs::write(&tmp, content).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &file).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn write_config_file(app: tauri::AppHandle, name: &str, content: String) -> Result<(), String> {
    let file = config_path(&app, name)?;
    if let Some(dir) = file.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    write_atomic(&file, &content)
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
    let dir = app_data_dir(&app)?;
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
