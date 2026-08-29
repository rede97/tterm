//! Frontend prompt plumbing: the Prompter seam, the production
//! event+park prompter, and the two response commands.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;

use super::BoxFuture;
use crate::relay::WsHub;
use crate::state::AppState;

// ── Frontend prompt plumbing ─────────────────────────────────────────

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostKeyPrompt {
    pub host: String,
    pub port: u16,
    pub key_type: String,
    pub fingerprint: String,
    // true = a DIFFERENT key is recorded for this host (possible MITM);
    // false = first time we see this host.
    pub mismatch: bool,
}

/// User interaction needed mid-handshake. Production: frontend collects
/// secrets in the SSH tab (or a modal when there is no tab) and confirms
/// host keys in a modal. Tests: auto-approve.
pub trait Prompter: Send + Sync {
    /// Ask for a password/passphrase. None = user cancelled (abort connect).
    fn ask_secret(&self, kind: &str, prompt: String) -> BoxFuture<Option<String>>;
    /// Confirm an unknown or changed host key.
    fn confirm_host_key(&self, info: HostKeyPrompt) -> BoxFuture<bool>;
}

pub enum PromptAnswer {
    Secret(Option<String>),
    Accept(bool),
}

pub type PendingPrompts = Arc<Mutex<HashMap<u64, tokio::sync::oneshot::Sender<PromptAnswer>>>>;

static NEXT_PROMPT: AtomicU64 = AtomicU64::new(1);

/// Holds a slot in `pending` until the park future completes or is
/// dropped (handshake cancelled). Without this, a timed-out `connect`
/// leaked the oneshot and a late Trust click had nowhere to go.
struct PendingSlot {
    pending: PendingPrompts,
    id: u64,
}

impl Drop for PendingSlot {
    fn drop(&mut self) {
        if let Ok(mut map) = self.pending.lock() {
            map.remove(&self.id);
        }
    }
}

// How long a frontend prompt may go unanswered before the handshake gives
// up: if the frontend dies, parking forever would wedge auth (and in the
// dead-mode auto-retry path pin a blocking thread permanently).
const PROMPT_TIMEOUT: Duration = Duration::from_secs(300);

/// Production prompter: emits a Tauri event and parks until the matching
/// `ssh_auth_response` / `ssh_hostkey_response` command arrives.
pub struct FrontendPrompter {
    hub: Arc<WsHub>,
    pending: PendingPrompts,
    /// Frontend tab id that should collect secrets in-terminal. Absent
    /// (key-install from Settings) → password modal. For first connect this
    /// is the pending tab id; for dead-mode reconnect it is the live session id.
    session_id: Option<String>,
}

impl FrontendPrompter {
    pub fn new(hub: Arc<WsHub>, pending: PendingPrompts) -> Self {
        Self {
            hub,
            pending,
            session_id: None,
        }
    }

    pub fn for_session(hub: Arc<WsHub>, pending: PendingPrompts, session_id: String) -> Self {
        Self {
            hub,
            pending,
            session_id: Some(session_id),
        }
    }

    fn park<T: Send + 'static>(
        &self,
        event: &str,
        payload: serde_json::Value,
        wrap: fn(PromptAnswer) -> Option<T>,
    ) -> BoxFuture<Option<T>> {
        let req_id = NEXT_PROMPT.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = tokio::sync::oneshot::channel::<PromptAnswer>();
        if let Ok(mut map) = self.pending.lock() {
            map.insert(req_id, tx);
        }
        let mut body = payload;
        body["reqId"] = serde_json::json!(req_id);
        if let Some(id) = &self.session_id {
            body["sessionId"] = serde_json::json!(id);
        }
        let sent = self.hub.emit(event, body).is_ok();
        let pending = self.pending.clone();
        Box::pin(async move {
            // Drop removes the oneshot if the handshake is cancelled
            // (TCP timeout used to leak it, so a late Trust went nowhere).
            let _slot = PendingSlot {
                pending,
                id: req_id,
            };
            if !sent {
                return None;
            }
            let answer = match tokio::time::timeout(PROMPT_TIMEOUT, rx).await {
                Ok(answer) => answer.ok(),
                // Frontend gone or never answered: treat as cancel (flows
                // into the auth-failure path) instead of parking forever.
                Err(_) => None,
            };
            answer.and_then(wrap)
        })
    }
}

impl Prompter for FrontendPrompter {
    fn ask_secret(&self, kind: &str, prompt: String) -> BoxFuture<Option<String>> {
        self.park::<String>(
            "ssh-auth-request",
            serde_json::json!({ "kind": kind, "prompt": prompt }),
            |a| match a {
                PromptAnswer::Secret(s) => s,
                _ => None,
            },
        )
    }

    fn confirm_host_key(&self, info: HostKeyPrompt) -> BoxFuture<bool> {
        let fut = self.park::<bool>(
            "ssh-hostkey-request",
            serde_json::to_value(&info).unwrap_or_default(),
            |a| match a {
                PromptAnswer::Accept(b) => Some(b),
                _ => None,
            },
        );
        Box::pin(async move { fut.await.unwrap_or(false) })
    }
}

#[tauri::command]
pub fn ssh_auth_response(
    state: tauri::State<AppState>,
    req_id: u64,
    secret: Option<String>,
) -> Result<(), String> {
    let tx = state
        .pending_prompts
        .lock()
        .map_err(|e| e.to_string())?
        .remove(&req_id);
    if let Some(tx) = tx {
        let _ = tx.send(PromptAnswer::Secret(secret));
    }
    Ok(())
}

#[tauri::command]
pub fn ssh_hostkey_response(
    state: tauri::State<AppState>,
    req_id: u64,
    accept: bool,
) -> Result<(), String> {
    let tx = state
        .pending_prompts
        .lock()
        .map_err(|e| e.to_string())?
        .remove(&req_id);
    if let Some(tx) = tx {
        let _ = tx.send(PromptAnswer::Accept(accept));
    }
    Ok(())
}
