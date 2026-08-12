//! Public-key installation (ssh-copy-id equivalent): probe the remote
//! shell family, then prepare/test/append authorized_keys.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use russh::client::{self, Handle};

use super::hostkey::known_hosts_path;
use super::hostkey::SshHandler;
use super::keys::{normalize_public_key, InstallResult};
use super::prompter::{FrontendPrompter, Prompter};
use super::session::authenticate;
use super::EmbeddedSshSpec;
use crate::state::AppState;

// ── Public-key installation (ssh-copy-id equivalent) ─────────────────

/// The remote shell family, decided by probing. Windows targets answer
/// either cmd or powershell depending on the sshd default-shell setting;
/// Linux and macOS both answer sh.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum TargetShell {
    Posix,
    WindowsCmd,
    WindowsPowerShell,
}

impl TargetShell {
    fn label(self) -> &'static str {
        match self {
            TargetShell::Posix => "posix",
            TargetShell::WindowsCmd => "windows-cmd",
            TargetShell::WindowsPowerShell => "windows-powershell",
        }
    }
}

/// Probe commands in order; the first that exits 0 identifies the shell.
/// `target_os` ("windows" | "linux" | "macos") narrows the candidate list.
///
/// Order matters. The PowerShell and cmd probes can only be answered by
/// the default shell itself (`$PSVersionTable` is a syntax error or
/// unknown command everywhere else; `ver` exists only in cmd). The sh
/// probe is NOT decisive: on Windows hosts with Git for Windows, sh.exe
/// sits on PATH and PowerShell/cmd will spawn it, so such a target
/// answers `sh -c "uname -s"` with MINGW64_NT and exit 0. Probing sh
/// first misclassified those hosts as Posix, and the
/// `mkdir … && chmod …` prepare then died outright — PowerShell 5.1 has
/// no `&&`. So sh goes LAST: it only ever matches hosts whose default
/// shell genuinely is a POSIX shell (including Windows sshd configured
/// with Git Bash as the default shell, where the POSIX steps do work —
/// bash executes them and ~ maps to %USERPROFILE%).
fn probe_plan(target_os: Option<&str>) -> Vec<(TargetShell, &'static str)> {
    const POSIX: (TargetShell, &str) = (TargetShell::Posix, "sh -c \"uname -s\"");
    const CMD: (TargetShell, &str) = (TargetShell::WindowsCmd, "ver");
    const PS: (TargetShell, &str) = (
        TargetShell::WindowsPowerShell,
        "$PSVersionTable.PSVersion | Out-Null",
    );
    match target_os {
        Some("windows") => vec![PS, CMD],
        Some("linux") | Some("macos") => vec![POSIX],
        _ => vec![PS, CMD, POSIX],
    }
}

/// The three install steps for a shell family: prepare the .ssh directory,
/// test whether the key is already authorized, append it. `key` is the
/// normalized "algo base64" form — no quotes, so single-quote wrapping is
/// safe on every shell.
struct InstallSteps {
    prepare: String,
    contains: String,
    append: String,
}

fn install_steps(shell: TargetShell, key: &str) -> InstallSteps {
    match shell {
        TargetShell::Posix => InstallSteps {
            prepare: "mkdir -p ~/.ssh && chmod 700 ~/.ssh && touch ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys".into(),
            contains: format!("grep -qxF '{key}' ~/.ssh/authorized_keys"),
            append: format!("echo '{key}' >> ~/.ssh/authorized_keys"),
        },
        TargetShell::WindowsCmd => InstallSteps {
            prepare: "if not exist \"%USERPROFILE%\\.ssh\" mkdir \"%USERPROFILE%\\.ssh\"".into(),
            contains: format!(
                "findstr /x /l /c:\"{key}\" \"%USERPROFILE%\\.ssh\\authorized_keys\""
            ),
            append: format!("echo {key}>> \"%USERPROFILE%\\.ssh\\authorized_keys\""),
        },
        TargetShell::WindowsPowerShell => InstallSteps {
            prepare: "New-Item -ItemType Directory -Force \"$env:USERPROFILE\\.ssh\" | Out-Null"
                .into(),
            contains: format!(
                "if ((Test-Path \"$env:USERPROFILE\\.ssh\\authorized_keys\") -and ((Get-Content \"$env:USERPROFILE\\.ssh\\authorized_keys\") -contains '{key}')) {{ exit 0 }} else {{ exit 1 }}"
            ),
            append: format!(
                "Add-Content \"$env:USERPROFILE\\.ssh\\authorized_keys\" '{key}'"
            ),
        },
    }
}

/// Run one command, collect stdout, return (exit status, stdout).
pub(crate) async fn exec_capture(
    handle: &Handle<SshHandler>,
    command: &str,
) -> Result<(u32, String), String> {
    let run = async {
        let channel = handle
            .channel_open_session()
            .await
            .map_err(|e| format!("channel open failed: {e}"))?;
        channel
            .exec(true, command)
            .await
            .map_err(|e| format!("exec failed: {e}"))?;
        let (mut rd, _wr) = channel.split();
        let mut status: Option<u32> = None;
        // Accumulate raw bytes and decode ONCE at the end: a multi-byte
        // UTF-8 sequence split across channel chunks would decode to
        // U+FFFD if each chunk were lossy-decoded on arrival.
        let mut out: Vec<u8> = Vec::new();
        loop {
            match rd.wait().await {
                Some(russh::ChannelMsg::Data { data }) => {
                    out.extend_from_slice(&data);
                }
                Some(russh::ChannelMsg::ExitStatus { exit_status }) => {
                    status = Some(exit_status);
                }
                // NB: do NOT break on Eof — for fast commands sshd delivers
                // stdout's EOF before it reaps the process and sends
                // exit-status. Only Close ends the conversation.
                Some(russh::ChannelMsg::Close) | None => break,
                _ => {}
            }
        }
        Ok::<(u32, String), String>((
            status.unwrap_or(1),
            String::from_utf8_lossy(&out).into_owned(),
        ))
    };
    tokio::time::timeout(Duration::from_secs(15), run)
        .await
        .map_err(|_| format!("remote command timed out: {command}"))?
}

/// Connect, authenticate (agent → identity files → password dialog), probe
/// the remote shell, then append the public key to authorized_keys.
pub(crate) async fn install_pubkey_with(
    spec: &EmbeddedSshSpec,
    public_key: &str,
    target_os: Option<String>,
    prompter: Arc<dyn Prompter>,
    known_hosts: Option<PathBuf>,
) -> Result<InstallResult, String> {
    let key = normalize_public_key(public_key)?;

    let mut config = client::Config::default();
    config.inactivity_timeout = None;
    config.nodelay = true;
    let handler = SshHandler {
        host: spec.hostname.clone(),
        port: spec.port,
        prompter: prompter.clone(),
        known_hosts,
        forwards: Arc::new(Mutex::new(HashMap::new())),
    };
    let mut handle = tokio::time::timeout(
        Duration::from_secs(15),
        client::connect(
            Arc::new(config),
            (spec.hostname.as_str(), spec.port),
            handler,
        ),
    )
    .await
    .map_err(|_| format!("Connection to {} timed out", spec.hostname))?
    .map_err(|e| format!("SSH handshake with {} failed: {e}", spec.hostname))?;
    authenticate(&mut handle, spec, &prompter, &Arc::new(Mutex::new(None))).await?;

    // Probe the remote shell: first candidate exiting 0 wins.
    let mut shell = None;
    for (candidate, probe) in probe_plan(target_os.as_deref()) {
        if let Ok((0, _)) = exec_capture(&handle, probe).await {
            shell = Some(candidate);
            break;
        }
    }
    let shell = shell.ok_or_else(|| {
        "could not detect the remote shell (tried powershell / cmd / sh)".to_string()
    })?;

    let steps = install_steps(shell, &key);
    let (status, out) = exec_capture(&handle, &steps.prepare).await?;
    if status != 0 {
        return Err(format!("failed to prepare ~/.ssh on the target: {out}"));
    }
    if let Ok((0, _)) = exec_capture(&handle, &steps.contains).await {
        return Ok(InstallResult {
            outcome: "already".into(),
            shell: shell.label().into(),
        });
    }
    let (status, out) = exec_capture(&handle, &steps.append).await?;
    if status != 0 {
        return Err(format!("failed to append the key on the target: {out}"));
    }
    Ok(InstallResult {
        outcome: "installed".into(),
        shell: shell.label().into(),
    })
}

/// Install a local public key on a remote host (ssh-copy-id equivalent).
/// `target_os`: "auto" (probe powershell → cmd → sh) or a restriction to
/// "windows" / "linux" / "macos".
#[tauri::command]
pub async fn ssh_install_pubkey(
    state: tauri::State<'_, AppState>,
    spec: EmbeddedSshSpec,
    public_key: String,
    target_os: Option<String>,
) -> Result<InstallResult, String> {
    let prompter: Arc<dyn Prompter> = Arc::new(FrontendPrompter::new(
        state.hub.clone(),
        state.pending_prompts.clone(),
    ));
    install_pubkey_with(&spec, &public_key, target_os, prompter, known_hosts_path()).await
}
