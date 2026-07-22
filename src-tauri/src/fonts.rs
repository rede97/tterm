pub(crate) fn strip_font_suffix(name: &str) -> Option<String> {
    for suffix in [" (TrueType)", " (OpenType)"] {
        if let Some(stripped) = name.strip_suffix(suffix) {
            return Some(stripped.to_string());
        }
    }
    None
}

#[tauri::command]
pub fn list_system_fonts() -> Vec<String> {
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


#[cfg(test)]
mod tests {
    use super::*;

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

}
