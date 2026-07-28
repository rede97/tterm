//! In-band disconnect handling: when a session's byte stream ends (shell
//! exit, SSH drop, serial unplug), the relay keeps the WebSocket alive and
//! plays a small dead-mode protocol INSIDE the terminal data stream:
//!
//!   1. reset sequences pull the terminal out of whatever mode the dead
//!      process left it in (alt screen, hidden cursor, mouse reporting…)
//!   2. a notice with the local time is printed into the scrollback
//!   3. upstream keystrokes are swallowed except Enter, which respawns
//!
//! Keeping this in-band means the prompt survives in scrollback, works for
//! any client, and Enter needs no frontend focus handling.

// Terminal mode reset. Cursor position is SAVED FIRST and RESTORED LAST
// (CSI s / CSI u — position only, unlike DECRC which would also restore the
// charset/attributes we are resetting): DECSTBM (`\x1b[r`) and origin-mode
// reset (`\x1b[?6l`) both home the cursor per VT spec, and without the
// save/restore the notice would print from (0,0) and OVERWRITE the most
// recent screen lines (the command the user just typed).
//
// Covers: alt screen (both variants), cursor visible + shape, attributes,
// mouse reporting, bracketed paste, cursor keys, autowrap, origin mode,
// scroll region, ASCII charset. The last three matter for REMOTE deaths
// (SSH): a remote TUI (vim/less/htop/tmux) can die leaving a DECSTBM scroll
// region or the DEC graphics charset active — local shells never do. A
// leftover scroll region would also break the pre-resume scroll (LFs scroll
// only inside the region), losing content to the fresh ConPTY's `\x1b[2J`.
const TERMINAL_RESET: &str = concat!(
    "\x1b[s",
    "\x1b[?1049l\x1b[?47l\x1b[?25h\x1b[0m\x1b[0 q",
    "\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l\x1b[?2004l\x1b[?1l\x1b[?7h",
    "\x1b[?6l\x1b[r\x1b(B\x0f",
    "\x1b[u",
);

// The notice injected downstream when a session's stream dies.
pub(crate) fn disconnect_notice() -> Vec<u8> {
    let ts = chrono::Local::now().format("%Y-%m-%d %H:%M:%S");
    let mut s = String::new();
    s.push_str(TERMINAL_RESET);
    s.push_str("\r\n\r\n");
    s.push_str(&format!("\x1b[1;31m── Session ended at {} ──\x1b[0m\r\n", ts));
    s.push_str("\x1b[2mPress Enter to reconnect\x1b[0m\r\n");
    s.into_bytes()
}

// One-line failure report when a respawn attempt fails (e.g. serial port
// still unplugged); dead mode stays active afterwards.
pub(crate) fn respawn_failed(msg: &str) -> Vec<u8> {
    format!("\x1b[31mReconnect failed: {}\x1b[0m — \x1b[2mpress Enter to retry\x1b[0m\r\n", msg).into_bytes()
}

// Pre-resume scroll, sent downstream right after a successful respawn.
// A fresh Windows ConPTY always opens with `\x1b[2J` (erase visible display)
// plus a blank initial frame — that is why a naive reconnect appears to
// "clear the screen". `2J` does NOT touch scrollback, so scrolling the dead
// session's viewport (disconnect notice + on-screen content) up into
// scrollback first makes the wipe harmless: history stays contiguous one
// page up. `\x1b[999B` parks the cursor at the bottom row so the following
// `rows` LFs scroll exactly one full viewport.
pub(crate) fn resume_scroll(rows: u16) -> Vec<u8> {
    let mut v = b"\x1b[999B".to_vec();
    v.extend(std::iter::repeat(b'\n').take(rows as usize));
    v
}

// Does this upstream keystroke batch contain Enter? CR / LF cover the main
// key in every mode; ESC O M is the numpad Enter in application keypad mode
// (a dead TUI app may have left it enabled).
pub(crate) fn contains_enter(buf: &[u8]) -> bool {
    buf.iter().any(|b| *b == b'\r' || *b == b'\n') || buf.windows(3).any(|w| w == b"\x1bOM")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn notice_resets_tui_modes_and_prompts() {
        let n = String::from_utf8(disconnect_notice()).unwrap();
        assert!(n.contains("\x1b[?1049l"), "leaves alt screen");
        assert!(n.contains("\x1b[?25h"), "restores cursor");
        assert!(n.contains("\x1b[?2004l"), "disables bracketed paste");
        assert!(n.contains("\x1b[r"), "resets scroll region (remote TUI deaths)");
        assert!(n.contains("\x1b[?6l"), "origin mode off");
        assert!(n.contains("\x1b(B"), "ASCII charset (DEC graphics reset)");
        assert!(n.contains("Session ended at"), "has timestamp line");
        assert!(n.contains("Enter"), "has reconnect hint");
    }

    #[test]
    fn failure_line_names_reason_and_hint() {
        let s = String::from_utf8(respawn_failed("COM3 not found")).unwrap();
        assert!(s.contains("COM3 not found"));
        assert!(s.contains("Enter"));
    }

    #[test]
    fn enter_detection_covers_cr_lf_and_appkey_numpad() {
        assert!(contains_enter(b"\r"));
        assert!(contains_enter(b"\n"));
        assert!(contains_enter(b"\x1bOM"));
        assert!(contains_enter(b"abc\r"));
        assert!(!contains_enter(b""));
        assert!(!contains_enter(b"x"));
        assert!(!contains_enter(b"\x1bOA")); // arrow up in app mode: not Enter
    }

    #[test]
    fn resume_scroll_parks_cursor_and_scrolls_one_viewport() {
        let v = resume_scroll(24);
        assert!(v.starts_with(b"\x1b[999B"), "cursor parked at bottom row first");
        assert_eq!(v.iter().filter(|&&b| b == b'\n').count(), 24);
        assert_eq!(v.len(), 6 + 24);
    }
}
