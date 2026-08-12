//! Local key management: list ~/.ssh keypairs and generate new ones.

use std::path::PathBuf;

use russh::keys::ssh_key;
use serde::Serialize;

// ── Key management (generate / list / install) ───────────────────────

/// One local keypair entry (from ~/.ssh/*.pub).
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshKeyInfo {
    pub name: String,        // file stem, e.g. "id_ed25519"
    pub path: String,        // private key path
    pub public_key: String,  // OpenSSH one-liner (with comment)
    pub fingerprint: String, // "SHA256:…"
}

/// Outcome of ssh_install_pubkey.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallResult {
    pub outcome: String, // "installed" | "already"
    // Which remote shell answered the probes — shown in the result toast.
    pub shell: String, // "posix" | "windows-cmd" | "windows-powershell"
}

fn ssh_dir() -> Option<PathBuf> {
    crate::ssh::ssh_config_path().and_then(|p| p.parent().map(|d| d.to_path_buf()))
}

/// Infallible CSPRNG over the OS RNG. ssh-key wants `CryptoRng` (i.e.
/// `TryRng<Error = Infallible>`); a getrandom failure mid-keygen is
/// unrecoverable, so panicking is the honest behavior.
struct OsRng;

impl rand_core::TryRng for OsRng {
    type Error = std::convert::Infallible;
    fn try_next_u32(&mut self) -> Result<u32, Self::Error> {
        let mut b = [0u8; 4];
        getrandom::fill(&mut b).expect("OS RNG failure");
        Ok(u32::from_le_bytes(b))
    }
    fn try_next_u64(&mut self) -> Result<u64, Self::Error> {
        let mut b = [0u8; 8];
        getrandom::fill(&mut b).expect("OS RNG failure");
        Ok(u64::from_le_bytes(b))
    }
    fn try_fill_bytes(&mut self, dst: &mut [u8]) -> Result<(), Self::Error> {
        getrandom::fill(dst).expect("OS RNG failure");
        Ok(())
    }
}

impl rand_core::TryCryptoRng for OsRng {}

/// Normalize a public key to "algo base64" (comment dropped): the comment
/// is free-form text and would break shell quoting on the remote side.
pub(crate) fn normalize_public_key(public_key: &str) -> Result<String, String> {
    let key = ssh_key::PublicKey::from_openssh(public_key)
        .map_err(|e| format!("invalid public key: {e}"))?;
    let line = key.to_openssh().map_err(|e| e.to_string())?;
    let mut parts = line.split_whitespace();
    match (parts.next(), parts.next()) {
        (Some(algo), Some(data)) => Ok(format!("{algo} {data}")),
        _ => Err("invalid public key".into()),
    }
}

fn key_info_from_pub(pub_path: &std::path::Path) -> Option<SshKeyInfo> {
    let content = std::fs::read_to_string(pub_path).ok()?;
    let line = content.lines().find(|l| !l.trim().is_empty())?;
    let key = ssh_key::PublicKey::from_openssh(line).ok()?;
    let stem = pub_path.file_stem()?.to_string_lossy().to_string();
    let priv_path = pub_path.parent()?.join(&stem);
    if !priv_path.exists() {
        return None; // orphan .pub — nothing to authenticate with later
    }
    Some(SshKeyInfo {
        name: stem,
        path: priv_path.to_string_lossy().to_string(),
        public_key: line.trim().to_string(),
        fingerprint: key.fingerprint(ssh_key::HashAlg::Sha256).to_string(),
    })
}

pub(crate) fn list_keys_in(dir: &std::path::Path) -> Vec<SshKeyInfo> {
    let mut out: Vec<SshKeyInfo> = std::fs::read_dir(dir)
        .map(|entries| {
            entries
                .flatten()
                .map(|e| e.path())
                .filter(|p| p.extension().and_then(|s| s.to_str()) == Some("pub"))
                .filter_map(|p| key_info_from_pub(&p))
                .collect()
        })
        .unwrap_or_default();
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

#[tauri::command]
pub fn ssh_list_keys() -> Result<Vec<SshKeyInfo>, String> {
    Ok(ssh_dir().map(|d| list_keys_in(&d)).unwrap_or_default())
}

pub(crate) fn keygen_in(
    dir: &std::path::Path,
    algorithm: &str,
    name: &str,
    passphrase: Option<String>,
) -> Result<SshKeyInfo, String> {
    let name = name.trim();
    if name.is_empty()
        || !name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.'))
    {
        return Err("Key name may only contain letters, digits, '.', '_' and '-'".into());
    }
    let algorithm = match algorithm {
        "ed25519" => ssh_key::Algorithm::Ed25519,
        // 4096-bit (ssh-key crate default); the hash alg is negotiated
        // per handshake at auth time.
        "rsa" => ssh_key::Algorithm::Rsa { hash: None },
        other => return Err(format!("unsupported algorithm: {other}")),
    };
    let priv_path = dir.join(name);
    let pub_path = dir.join(format!("{name}.pub"));
    if priv_path.exists() || pub_path.exists() {
        return Err(format!("{name} already exists — pick another name"));
    }

    let mut rng = OsRng;
    let mut key = ssh_key::PrivateKey::random(&mut rng, algorithm).map_err(|e| e.to_string())?;
    key.set_comment("tterm");
    if let Some(pp) = passphrase.filter(|p| !p.is_empty()) {
        key = key
            .encrypt(&mut rng, pp.as_bytes())
            .map_err(|e| e.to_string())?;
    }
    let priv_pem = key
        .to_openssh(ssh_key::LineEnding::LF)
        .map_err(|e| e.to_string())?;
    std::fs::write(&priv_path, priv_pem.as_bytes()).map_err(|e| e.to_string())?;
    // 0600 on unix — OpenSSH clients refuse world-readable private keys.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&priv_path, std::fs::Permissions::from_mode(0o600));
    }
    let pub_line = key.public_key().to_openssh().map_err(|e| e.to_string())?;
    std::fs::write(&pub_path, format!("{pub_line}\n")).map_err(|e| e.to_string())?;

    key_info_from_pub(&pub_path).ok_or_else(|| "generated key failed to re-parse".into())
}

/// Generate a keypair in ~/.ssh. Refuses to overwrite an existing name.
#[tauri::command]
pub fn ssh_keygen(
    algorithm: String,
    name: String,
    passphrase: Option<String>,
) -> Result<SshKeyInfo, String> {
    let dir = ssh_dir().ok_or("cannot locate the ~/.ssh directory")?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    keygen_in(&dir, &algorithm, &name, passphrase)
}
