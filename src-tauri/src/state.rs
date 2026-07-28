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
}

// Parameters needed to respawn a session (reconnect).
#[derive(Clone)]
pub enum SpawnSpec {
    Pty { command: Option<String> },
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

// Control messages for the serial I/O pump thread.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SerialCtl {
    SetBaud(u32),
    SetOutputNewline(NewlineMode),
}

pub struct AppState {
    pub(crate) sessions: Arc<Mutex<HashMap<String, PtySession>>>,
    pub(crate) serial_sessions: Arc<Mutex<HashMap<String, SerialSession>>>,
    pub(crate) next_id: Mutex<u32>,
    pub(crate) initial_cwd: Option<PathBuf>,
    pub(crate) hub: Arc<WsHub>,
}

impl AppState {
    // Connect info handed back to the frontend after (re)spawning a session.
    pub(crate) fn ws_result(&self, id: String) -> WsConnectResult {
        WsConnectResult { id, port: self.hub.port, token: self.hub.token.clone() }
    }
}
