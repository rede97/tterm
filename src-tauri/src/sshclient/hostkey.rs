//! Host key verification against ~/.ssh/known_hosts (TOFU + re-learn),
//! and the russh client handler that runs it mid-handshake.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use russh::client::{self};
use russh::keys::ssh_key;

use super::forward::bridge_tcp_channel;
use super::prompter::{HostKeyPrompt, Prompter};
use super::ForwardEntry;

// ── Host key verification ────────────────────────────────────────────

pub(crate) fn known_hosts_path() -> Option<PathBuf> {
    crate::ssh::ssh_config_path().map(|p| p.with_file_name("known_hosts"))
}

/// OpenSSH hashed-host matching: a `|1|base64(salt)|base64(hmac)` line
/// matches when HMAC-SHA1(salt, pattern) equals the stored hash, for either
/// address form. Mirrors russh's own known_hosts hash check.
fn hashed_line_matches(first_field: &str, patterns: &[String; 2]) -> bool {
    use base64::Engine;
    use hmac::{Hmac, KeyInit, Mac};
    use sha1::Sha1;

    let Some(rest) = first_field.strip_prefix("|1|") else {
        return false;
    };
    let mut parts = rest.split('|');
    let (Some(salt_b64), Some(hash_b64)) = (parts.next(), parts.next()) else {
        return false;
    };
    let b64 = base64::engine::general_purpose::STANDARD;
    let (Ok(salt), Ok(stored)) = (b64.decode(salt_b64), b64.decode(hash_b64)) else {
        return false;
    };
    patterns.iter().any(|pat| {
        let Ok(mut mac) = Hmac::<Sha1>::new_from_slice(&salt) else {
            return false;
        };
        mac.update(pat.as_bytes());
        mac.verify_slice(&stored).is_ok()
    })
}

/// Drop every non-comment line naming `host` (or `[host]:port`), including
/// hashed `|1|…` entries, so a changed key can be re-learned cleanly.
fn remove_known_host(path: &PathBuf, host: &str, port: u16) -> Result<(), String> {
    let content = match std::fs::read_to_string(path) {
        Ok(c) => c,
        Err(_) => return Ok(()), // nothing to remove
    };
    let patterns = [host.to_string(), format!("[{}]:{}", host, port)];
    let kept: Vec<&str> = content
        .lines()
        .filter(|line| {
            let first = line.split_whitespace().next().unwrap_or("");
            if patterns.iter().any(|p| p == first) {
                return false;
            }
            !hashed_line_matches(first, &patterns)
        })
        .collect();
    std::fs::write(path, kept.join("\n") + "\n").map_err(|e| e.to_string())
}

// ── russh client handler ─────────────────────────────────────────────

pub struct SshHandler {
    pub(crate) host: String,
    pub(crate) port: u16,
    pub(crate) prompter: Arc<dyn Prompter>,
    pub(crate) known_hosts: Option<PathBuf>,
    pub(crate) forwards: Arc<Mutex<HashMap<u64, ForwardEntry>>>,
}

impl client::Handler for SshHandler {
    type Error = russh::Error;

    async fn check_server_key(&mut self, key: &ssh_key::PublicKey) -> Result<bool, Self::Error> {
        let path = match &self.known_hosts {
            Some(p) => p.clone(),
            None => return Ok(false), // no home dir — refuse rather than trust blindly
        };
        let fingerprint = key.fingerprint(ssh_key::HashAlg::Sha256).to_string();
        let key_type = key.algorithm().to_string();
        let prompt = |mismatch: bool| HostKeyPrompt {
            host: self.host.clone(),
            port: self.port,
            key_type: key_type.clone(),
            fingerprint: fingerprint.clone(),
            mismatch,
        };
        match russh::keys::known_hosts::check_known_hosts_path(&self.host, self.port, key, &path) {
            Ok(true) => Ok(true),
            Ok(false) => {
                // First contact (or key type not yet recorded): TOFU dialog.
                if !self.prompter.confirm_host_key(prompt(false)).await {
                    return Ok(false);
                }
                Ok(russh::keys::known_hosts::learn_known_hosts_path(
                    &self.host, self.port, key, &path,
                )
                .is_ok())
            }
            Err(russh::keys::Error::KeyChanged { .. }) => {
                if !self.prompter.confirm_host_key(prompt(true)).await {
                    return Ok(false);
                }
                if remove_known_host(&path, &self.host, self.port).is_err() {
                    return Ok(false);
                }
                Ok(russh::keys::known_hosts::learn_known_hosts_path(
                    &self.host, self.port, key, &path,
                )
                .is_ok())
            }
            Err(_) => Ok(false),
        }
    }

    /// Server-side socket opened for a remote (-R) forward: connect the
    /// mapped local target and bridge the two.
    async fn server_channel_open_forwarded_tcpip(
        &mut self,
        channel: russh::Channel<client::Msg>,
        _connected_address: &str,
        connected_port: u32,
        _originator_address: &str,
        _originator_port: u32,
        reply: client::ChannelOpenHandle,
        _session: &mut client::Session,
    ) -> Result<(), Self::Error> {
        reply.accept().await;
        let target = self.forwards.lock().ok().and_then(|t| {
            t.values()
                .find(|f| f.info.kind == "remote" && f.info.listen_port as u32 == connected_port)
                .map(|f| (f.info.target_host.clone(), f.info.target_port))
        });
        if let Some((host, port)) = target {
            tauri::async_runtime::spawn(async move {
                match tokio::net::TcpStream::connect((host.as_str(), port)).await {
                    Ok(stream) => bridge_tcp_channel(stream, channel).await,
                    Err(_) => {}
                }
            });
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Build the OpenSSH `|1|salt|hash` first-field for a host pattern.
    fn hash_host(pattern: &str, salt: &[u8]) -> String {
        use base64::Engine;
        use hmac::{Hmac, KeyInit, Mac};
        use sha1::Sha1;

        let b64 = base64::engine::general_purpose::STANDARD;
        let mut mac = Hmac::<Sha1>::new_from_slice(salt).unwrap();
        mac.update(pattern.as_bytes());
        let hash = mac.finalize().into_bytes();
        format!("|1|{}|{}", b64.encode(salt), b64.encode(hash))
    }

    #[test]
    fn remove_known_host_handles_hashed_entries() {
        let dir = std::env::temp_dir().join(format!("tterm-test-kh-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("known_hosts");

        let salt = b"01234567890123456789"; // 20-byte salt, as ssh-keygen -H uses
        let hashed_match = hash_host("example.com", salt);
        let hashed_port = hash_host("[example.com]:2222", salt);
        let hashed_other = hash_host("other.example.com", salt);
        let content = format!(
            "# comment\nexample.com ssh-ed25519 AAAA-plain\n[example.com]:2222 ssh-rsa AAAA-bracket\n{hashed_match} ssh-ed25519 AAAA-hashed\n{hashed_port} ssh-ed25519 AAAA-hp\n{hashed_other} ssh-ed25519 AAAA-keep\n"
        );
        std::fs::write(&path, content).unwrap();

        // Port 22 removal: plain + bare-hashed go; bracketed :2222 is a
        // DIFFERENT endpoint entry and stays (matches OpenSSH semantics).
        remove_known_host(&path, "example.com", 22).unwrap();
        let after = std::fs::read_to_string(&path).unwrap();
        assert!(after.contains("# comment"));
        assert!(
            !after.contains("AAAA-plain"),
            "plain entry removed: {after}"
        );
        assert!(
            !after.contains("AAAA-hashed"),
            "hashed entry removed: {after}"
        );
        assert!(
            after.contains("AAAA-bracket"),
            ":2222 entry is a different endpoint: {after}"
        );
        assert!(
            after.contains("AAAA-hp"),
            ":2222 hashed entry stays: {after}"
        );
        assert!(after.contains("AAAA-keep"), "unrelated host kept: {after}");

        // Port 2222 removal: the bracketed and hashed `[host]:port` forms go.
        remove_known_host(&path, "example.com", 2222).unwrap();
        let after = std::fs::read_to_string(&path).unwrap();
        assert!(
            !after.contains("AAAA-bracket"),
            "bracketed entry removed: {after}"
        );
        assert!(
            !after.contains("AAAA-hp"),
            "hashed [host]:port removed: {after}"
        );
        assert!(after.contains("AAAA-keep"), "unrelated host kept: {after}");

        let _ = std::fs::remove_dir_all(&dir);
    }
}
