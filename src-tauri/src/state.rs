use portable_pty::MasterPty;
use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

#[derive(Clone, Serialize)]
pub struct WsConnectResult {
    pub(crate) id: String,
    pub(crate) port: u16,
}

pub struct PtySession {
    // None after the child exits (watchdog drops the master to unblock the
    // relay read loop) — the spec stays behind for reconnection.
    pub(crate) master: Option<Box<dyn MasterPty + Send>>,
    pub(crate) spec: SpawnSpec,
    pub(crate) nonce: u64,
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
    },
}

// Control messages for the serial I/O pump thread.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SerialCtl {
    SetBaud(u32),
}

pub struct AppState {
    pub(crate) sessions: Arc<Mutex<HashMap<String, PtySession>>>,
    pub(crate) serial_sessions: Mutex<HashMap<String, SerialSession>>,
    pub(crate) next_id: Mutex<u32>,
    pub(crate) initial_cwd: Option<PathBuf>,
}
