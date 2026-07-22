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
    pub(crate) master: Box<dyn MasterPty + Send>,
}

pub struct SerialSession {
    pub(crate) cancel: Arc<AtomicBool>,
    pub(crate) ctl: std::sync::mpsc::Sender<SerialCtl>,
}

// Control messages for the serial I/O pump thread.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SerialCtl {
    SetBaud(u32),
}

pub struct AppState {
    pub(crate) sessions: Mutex<HashMap<String, PtySession>>,
    pub(crate) serial_sessions: Mutex<HashMap<String, SerialSession>>,
    pub(crate) next_id: Mutex<u32>,
    pub(crate) initial_cwd: Option<PathBuf>,
}
