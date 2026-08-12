use serde::Serialize;

#[derive(Clone, Serialize, Debug)]
pub struct VsInstallation {
    path: String,
    version: String,
    instance_id: Option<String>,
}

pub(crate) fn try_vswhere() -> Vec<VsInstallation> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let vswhere = r"C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe";
        let output = match std::process::Command::new(vswhere)
            .args([
                "-format",
                "json",
                "-products",
                "*",
                "-requires",
                "Microsoft.VisualStudio.Component.VC.Tools.x86.x64",
            ])
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
        instances
            .into_iter()
            .filter_map(|inst| {
                let path = inst["installationPath"].as_str()?.to_string();
                let version = inst["installationVersion"].as_str()?.to_string();
                let instance_id = inst["instanceId"].as_str().map(|s| s.to_string());
                Some(VsInstallation {
                    path,
                    version,
                    instance_id,
                })
            })
            .collect()
    }
    #[cfg(not(target_os = "windows"))]
    {
        vec![]
    }
}

pub(crate) fn try_common_vs_paths() -> Vec<VsInstallation> {
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
                    result.push(VsInstallation {
                        path,
                        version: year.to_string(),
                        instance_id: None,
                    });
                }
            }
        }
    }
    result
}

#[tauri::command]
pub fn find_vs_instances() -> Vec<VsInstallation> {
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

pub(crate) fn load_wt_settings_raw() -> Option<String> {
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
    {
        None
    }
}

pub(crate) fn load_wt_fragments() -> Vec<String> {
    #[cfg(target_os = "windows")]
    {
        let mut result = Vec::new();
        let la = match std::env::var("LOCALAPPDATA") {
            Ok(v) => v.clone(),
            Err(_) => return result,
        };
        let pd = match std::env::var("ProgramData") {
            Ok(v) => v,
            Err(_) => return result,
        };
        let frag_dirs = [
            format!("{}\\Packages\\Microsoft.WindowsTerminal_8wekyb3d8bbwe\\LocalState\\Fragments", la),
            format!("{}\\Packages\\Microsoft.WindowsTerminalPreview_8wekyb3d8bbwe\\LocalState\\Fragments", la),
            format!("{}\\Microsoft\\Windows Terminal\\Fragments", la),
            format!("{pd}\\Microsoft\\Windows Terminal\\Fragments"),
        ];
        for d in &frag_dirs {
            let dir = std::path::Path::new(d);
            if !dir.is_dir() {
                continue;
            }
            // fragments are in subdirectories (e.g. Git/git-bash.json)
            if let Ok(entries) = std::fs::read_dir(dir) {
                for entry in entries.flatten() {
                    let p = entry.path();
                    if p.is_dir() {
                        if let Ok(sub) = std::fs::read_dir(&p) {
                            for f in sub.flatten() {
                                let fp = f.path();
                                if fp.extension().is_some_and(|e| e == "json") {
                                    if let Ok(c) = std::fs::read_to_string(&fp) {
                                        result.push(c);
                                    }
                                }
                            }
                        }
                    } else if p.extension().is_some_and(|e| e == "json") {
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
    {
        Vec::new()
    }
}

#[tauri::command]
pub fn read_wt_settings() -> Option<String> {
    load_wt_settings_raw()
}

#[tauri::command]
pub fn read_wt_fragments() -> Vec<String> {
    load_wt_fragments()
}
