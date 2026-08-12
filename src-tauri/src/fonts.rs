pub(crate) fn strip_font_suffix(name: &str) -> Option<String> {
    for suffix in [" (TrueType)", " (OpenType)"] {
        if let Some(stripped) = name.strip_suffix(suffix) {
            return Some(stripped.to_string());
        }
    }
    None
}

/// Registry value names are "<family> <weight…> (TrueType)" — one value per
/// FACE ("JetBrainsMono NF ExtraBold Italic", "Consolas Bold"). CSS wants
/// the bare family, so trailing weight tokens are collapsed. Tokens that
/// are also genuine family names on Windows (Black, Narrow, Condensed,
/// Book) are deliberately NOT stripped: "Arial Black" must survive.
const WEIGHT_TOKENS: [&str; 12] = [
    "Regular",
    "Bold",
    "Italic",
    "Thin",
    "ExtraLight",
    "Light",
    "SemiLight",
    "Medium",
    "SemiBold",
    "DemiBold",
    "ExtraBold",
    "Heavy",
];

pub(crate) fn css_family(reg_value_name: &str) -> Option<String> {
    let mut fam = strip_font_suffix(reg_value_name)?;
    while let Some((head, last)) = fam.rsplit_once(' ') {
        if WEIGHT_TOKENS.contains(&last) {
            fam = head.to_string();
        } else {
            break;
        }
    }
    Some(fam)
}

#[tauri::command]
pub fn list_system_fonts() -> Vec<String> {
    use winreg::enums::*;
    use winreg::RegKey;
    let mut names: Vec<String> = Vec::new();
    // HKCU: per-user installs (%LOCALAPPDATA%\Microsoft\Windows\Fonts) —
    // what non-admin "Install" does on Windows 10/11. HKLM alone misses
    // every font installed without elevation.
    for hive in [HKEY_LOCAL_MACHINE, HKEY_CURRENT_USER] {
        if let Ok(key) =
            RegKey::predef(hive).open_subkey(r"SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts")
        {
            for v in key.enum_values().filter_map(|r| r.ok()) {
                if let Some(family) = css_family(&v.0) {
                    names.push(family);
                }
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
        assert_eq!(
            strip_font_suffix("Consolas (TrueType)"),
            Some("Consolas".to_string())
        );
    }

    #[test]
    fn strip_opentype_suffix() {
        assert_eq!(
            strip_font_suffix("Segoe UI (OpenType)"),
            Some("Segoe UI".to_string())
        );
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

    // -- css_family --

    #[test]
    fn collapses_weight_faces_to_family() {
        // Nerd Font per-face registrations collapse to the CSS family.
        assert_eq!(
            css_family("JetBrainsMono NF ExtraBold Italic (TrueType)").as_deref(),
            Some("JetBrainsMono NF")
        );
        assert_eq!(
            css_family("JetBrainsMono NFM Regular (TrueType)").as_deref(),
            Some("JetBrainsMono NFM")
        );
        assert_eq!(
            css_family("JetBrainsMonoNL NFP Thin (TrueType)").as_deref(),
            Some("JetBrainsMonoNL NFP")
        );
        assert_eq!(
            css_family("Consolas Bold (TrueType)").as_deref(),
            Some("Consolas")
        );
        assert_eq!(
            css_family("Consolas (TrueType)").as_deref(),
            Some("Consolas")
        );
    }

    #[test]
    fn keeps_weight_named_families() {
        // These are real family names, not faces of a shorter family.
        assert_eq!(
            css_family("Arial Black (TrueType)").as_deref(),
            Some("Arial Black")
        );
        assert_eq!(
            css_family("Arial Narrow (TrueType)").as_deref(),
            Some("Arial Narrow")
        );
    }

    #[test]
    fn rejects_unknown_suffix() {
        assert_eq!(css_family("Some Font (Raster)"), None);
    }
}
