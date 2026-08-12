//! Embedded SSH client (russh) — see docs/ssh-client.md.
//!
//! An embedded SSH session is just another byte-pipe producer for the relay
//! hub: the shell channel's halves are adapted into the blocking
//! `Read`/`Write` pair `register_session` expects, so the frontend, dead-mode
//! reconnect, and AI sharing work unchanged. Auth secrets and host-key
//! confirmations reach the frontend through events + response commands
//! (the `Prompter` seam below); tests inject an auto-approving prompter.
//!
//! Module map: `prompter` (frontend dialogs), `hostkey` (known_hosts +
//! russh handler), `session` (connect/auth + relay bridge + lifecycle),
//! `forward` (port forwarding + SOCKS5), `keys` (keygen/list),
//! `install` (ssh-copy-id equivalent). Shared session-state types live here.

use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, AtomicU64};
use std::sync::{Arc, Mutex};

use russh::client::{self, Handle};
use russh::ChannelWriteHalf;
use serde::{Deserialize, Serialize};

pub(crate) mod bridge;
pub(crate) mod forward;
pub(crate) mod hostkey;
pub(crate) mod install;
pub(crate) mod keys;
pub(crate) mod prompter;
pub(crate) mod session;
#[cfg(test)]
mod tests;

pub use prompter::PendingPrompts;
pub(crate) use session::{kill_ssh_session, resize_ssh_session};

// Test-only surface: integration tests (tests.rs, `use super::*`) exercise
// internals directly. Explicit list — no glob re-exports, so production
// code outside this module can't reach in through the wildcard.
#[cfg(test)]
pub(crate) use bridge::bridge_tcp_channel;
#[cfg(test)]
pub(crate) use forward::add_forward;
#[cfg(test)]
pub(crate) use hostkey::SshHandler;
#[cfg(test)]
pub(crate) use install::{exec_capture, install_pubkey_with};
#[cfg(test)]
pub(crate) use keys::{keygen_in, list_keys_in};
#[cfg(test)]
pub(crate) use prompter::{HostKeyPrompt, Prompter};
#[cfg(test)]
pub(crate) use session::{authenticate, connect_session_with, spawn_upstream_pump};

pub type BoxFuture<T> = Pin<Box<dyn Future<Output = T> + Send>>;

// ── Session state ────────────────────────────────────────────────────

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmbeddedSshSpec {
    pub hostname: String,
    pub port: u16,
    pub user: String,
    pub identity_file: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForwardInfo {
    pub forward_id: u64,
    pub kind: String, // "local" | "remote"
    pub listen_host: String,
    pub listen_port: u16,
    pub target_host: String,
    pub target_port: u16,
}

pub(crate) struct ForwardEntry {
    pub info: ForwardInfo,
    // Local forwards run a listener task we can abort; remote forwards are
    // cancelled through the session handle (cancel_tcpip_forward).
    pub abort: Option<tauri::async_runtime::JoinHandle<()>>,
}

pub(crate) struct SshLive {
    handle: Arc<Handle<hostkey::SshHandler>>,
    shell_writer: Arc<ChannelWriteHalf<client::Msg>>,
}

/// All fields are Arc-shared, so cloning is cheap and shares live state —
/// the respawn path and the forward commands hold their own copies.
#[derive(Clone)]
pub struct SshSession {
    pub(crate) cancel: Arc<AtomicBool>,
    // Notified to stop bridge/listener tasks without waiting out timeouts.
    pub(crate) close_notify: Arc<tokio::sync::Notify>,
    pub(crate) live: Arc<tokio::sync::Mutex<Option<SshLive>>>,
    pub(crate) size: Arc<Mutex<(u32, u32)>>, // (cols, rows)
    pub(crate) spec: EmbeddedSshSpec,
    // Password that already worked once — lets dead-mode respawn re-auth
    // without a dialog. In memory only, dropped with the tab.
    pub(crate) cached_password: Arc<Mutex<Option<String>>>,
    pub(crate) forwards: Arc<Mutex<HashMap<u64, ForwardEntry>>>,
    pub(crate) next_forward: Arc<AtomicU64>,
}
