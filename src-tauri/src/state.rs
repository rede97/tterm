use portable_pty::MasterPty;
use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

use crate::relay::WsHub;

#[derive(Clone, Serialize)]
pub struct WsConnectResult {
    pub(crate) id: String,
    // Hub endpoint (same for every session) + per-process auth token.
    // The frontend connects to ws://127.0.0.1:<port>/pty/<id>?token=<token>.
    pub(crate) port: u16,
    pub(crate) token: String,
}

pub struct PtySession {
    // None after the child exits (watchdog drops the master to unblock the
    // relay read loop) — the spec stays behind for reconnection.
    pub(crate) master: Option<Box<dyn MasterPty + Send>>,
    pub(crate) nonce: u64,
    // Last known terminal size; a respawned PTY is created at this size
    // instead of the 80x24 default.
    pub(crate) size: portable_pty::PtySize,
}

// Emitted on the "session-state" Tauri event when a session dies / respawns
// (drives the tab-label strikethrough; the in-band prompt does the rest).
#[derive(Clone, Serialize)]
pub struct SessionState {
    pub(crate) id: String,
    pub(crate) alive: bool,
}

pub struct SerialSession {
    pub(crate) cancel: Arc<AtomicBool>,
    pub(crate) ctl: std::sync::mpsc::Sender<SerialCtl>,
    // None = not reconnectable (e.g. demo TTY)
    pub(crate) spec: Option<SpawnSpec>,
    // Auto-reconnect preference saved when the port is manually released
    // (serial_disconnect suppresses the retry; serial_reconnect restores it).
    pub(crate) auto_hold_restore: bool,
}

// Parameters needed to respawn a session (reconnect).
#[derive(Clone)]
pub enum SpawnSpec {
    Pty { command: Option<String>, cwd: Option<PathBuf> },
    Ssh { hostname: String, port: u16, user: String },
    Serial {
        port_name: String,
        baud_rate: u32,
        data_bits: u8,
        parity: String,
        stop_bits: u8,
        flow_control: String,
        output_newline: String,
    },
}

use crate::newline::NewlineMode;

// Live modem-line snapshot for the serial quick panel. `rts`/`dtr` are the
// states we last drove (the lines cannot be read back); `cts`/`dsr` are
// sampled from the device. `supported` is false when the driver cannot
// report modem lines at all — the UI greys the flow-control block then.
#[derive(Clone, Copy, Debug, serde::Serialize)]
pub struct SerialLineState {
    pub rts: bool,
    pub cts: bool,
    pub dtr: bool,
    pub dsr: bool,
    pub supported: bool,
}

// Control messages for the serial I/O pump thread.
#[derive(Debug, Clone)]
pub enum SerialCtl {
    SetBaud(u32),
    SetOutputNewline(NewlineMode),
    // Drive the RTS modem line (default asserted at open).
    SetRts(bool),
    // Drive the DTR modem line (default asserted at open).
    SetDtr(bool),
    // Switch flow control live: "none" | "software" | "hardware".
    SetFlowControl(String),
    // Sample modem lines; the pump answers on this channel.
    QueryLines(std::sync::mpsc::Sender<SerialLineState>),
    // Terminal size in cells — forwarded from pty_resize for sessions that
    // render size-dependent content themselves (Anime TTY, debug builds
    // only — hence the release-only allow). Real serial ports ignore it.
    #[cfg_attr(not(debug_assertions), allow(dead_code))]
    SetSize(u16, u16),
}

pub struct AppState {
    pub(crate) sessions: Arc<Mutex<HashMap<String, PtySession>>>,
    pub(crate) serial_sessions: Arc<Mutex<HashMap<String, SerialSession>>>,
    pub(crate) ssh_sessions: Arc<Mutex<HashMap<String, crate::sshclient::SshSession>>>,
    // Per-session auto-reconnect flags shared with the relay's dead-mode
    // pump (ReconnectHooks::auto_retry). Sessions without reconnect hooks
    // (demo TTYs) never appear here.
    pub(crate) auto_reconnect: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
    // Frontend dialog roundtrips in flight (ssh auth / host-key confirm).
    pub(crate) pending_prompts: crate::sshclient::PendingPrompts,
    pub(crate) next_id: Mutex<u32>,
    pub(crate) initial_cwd: Option<PathBuf>,
    pub(crate) hub: Arc<WsHub>,
}

impl AppState {
    // Connect info handed back to the frontend after (re)spawning a session.
    pub(crate) fn ws_result(&self, id: String) -> WsConnectResult {
        WsConnectResult { id, port: self.hub.port, token: self.hub.token.clone() }
    }

    // Create the shared auto-reconnect flag for a session being registered.
    // The flag outlives individual respawns: it is removed only on tab kill.
    pub(crate) fn register_auto_reconnect(&self, id: &str) -> Arc<AtomicBool> {
        let flag = Arc::new(AtomicBool::new(false));
        if let Ok(mut map) = self.auto_reconnect.lock() {
            map.insert(id.to_string(), flag.clone());
        }
        flag
    }
}
