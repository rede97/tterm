// ConPTY IME capability probe — Win10 inbox ConPTY often swallows DECTCEM
// (`ESC[?25l`) even in alt screen, so xterm never sees a hidden cursor and
// the fake-caret scan must run while the hardware cursor looks visible.
// Win11 (build >= 22000) is skipped: its ConPTY forwards hide, and the
// aggressive scan is not applied. Result is persisted by the frontend in
// conpty-ime.json (re-probed when the app version changes).

use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::Serialize;
use std::io::Read;
use std::time::Duration;

/// Windows 11's first public build. NT 10.0 below this is Windows 10.
pub const WIN11_BUILD: u32 = 22000;

const IME_PROBE_VT: &[u8] =
    b"\x1b[?1049h\x1b[?25l\x1b[2J\x1b[H\x1b[10;40H\x1b[7m \x1b[0m\x1b[20;1H";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImeCapsProbe {
    pub win10: bool,
    pub win_build: u32,
    pub cursor_hide_forwarded: bool,
}

#[tauri::command]
pub fn pty_probe_ime_caps() -> Result<ImeCapsProbe, String> {
    let win_build = windows_build_number();
    let win10 = is_win10_build(win_build);
    if !win10 {
        return Ok(ImeCapsProbe {
            win10: false,
            win_build,
            cursor_hide_forwarded: true,
        });
    }
    let forwarded = probe_cursor_hide_forwarded().unwrap_or(false);
    Ok(ImeCapsProbe {
        win10: true,
        win_build,
        cursor_hide_forwarded: forwarded,
    })
}

pub fn windows_build_number() -> u32 {
    #[cfg(windows)]
    {
        let hklm = winreg::RegKey::predef(winreg::enums::HKEY_LOCAL_MACHINE);
        let Ok(key) = hklm.open_subkey("SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion") else {
            return 0;
        };
        let s: String = key.get_value("CurrentBuildNumber").unwrap_or_default();
        s.parse().unwrap_or(0)
    }
    #[cfg(not(windows))]
    {
        0
    }
}

pub fn is_win10_build(build: u32) -> bool {
    build > 0 && build < WIN11_BUILD
}

pub fn vt_forwards_cursor_hide(bytes: &[u8]) -> bool {
    bytes.windows(6).any(|w| w == b"\x1b[?25l")
}

fn probe_cursor_hide_forwarded() -> Result<bool, String> {
    let path = std::env::temp_dir().join(format!("tterm-ime-probe-{}.bin", std::process::id()));
    std::fs::write(&path, IME_PROBE_VT).map_err(|e| e.to_string())?;
    let bytes = read_probe_output(&path);
    let _ = std::fs::remove_file(&path);
    Ok(vt_forwards_cursor_hide(&bytes?))
}

fn read_probe_output(path: &std::path::Path) -> Result<Vec<u8>, String> {
    let pty_sys = native_pty_system();
    let pair = pty_sys
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    #[cfg(windows)]
    let cmd = {
        let mut c = CommandBuilder::new("cmd.exe");
        c.arg("/c");
        c.arg("type");
        c.arg(path.as_os_str());
        c
    };
    #[cfg(not(windows))]
    let cmd = {
        let mut c = CommandBuilder::new("cat");
        c.arg(path.as_os_str());
        c
    };

    let mut child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pair.slave);
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let mut buf = Vec::new();
        let mut tmp = [0u8; 4096];
        while let Ok(n) = reader.read(&mut tmp) {
            if n == 0 {
                break;
            }
            buf.extend_from_slice(&tmp[..n]);
            if buf.len() > 32 * 1024 {
                break;
            }
        }
        let _ = tx.send(buf);
    });
    let _ = child.wait();
    drop(pair.master);
    Ok(rx
        .recv_timeout(Duration::from_millis(1500))
        .unwrap_or_default())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn win11_build_is_not_win10() {
        assert!(!is_win10_build(22000));
        assert!(!is_win10_build(26100));
        assert!(is_win10_build(19045));
        assert!(!is_win10_build(0));
    }

    #[test]
    fn hide_sequence_detected_in_raw_vt() {
        assert!(vt_forwards_cursor_hide(IME_PROBE_VT));
        assert!(!vt_forwards_cursor_hide(b"\x1b[2J\x1b[Hhello"));
    }
}
