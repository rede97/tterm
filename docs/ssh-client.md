# Embedded SSH client — design

Final-state design of the built-in SSH client (`src-tauri/src/sshclient/`,
russh). Replaces spawning the system `ssh.exe` via ConPTY for SSH tabs; the
spawned-binary path stays as a fallback (Settings → SSH → "Built-in SSH
client" toggle, default on).

## Why a built-in client

- **Dynamic port forwarding** — a running session can add/remove
  local/remote/SOCKS5 forwardings at runtime through direct API calls. With
  the spawned binary this needs the fragile `~C` escape console or an
  external ControlMaster socket.
- **Auth UX under our control** — password and key-passphrase prompts
  happen in the SSH tab (OpenSSH-style, no echo); host-key confirmation is
  a dialog. Settings key-install (no tab) still uses the password modal.
  Not ConPTY stdin fights.
- **Key management** — generate key pairs and install public keys
  (ssh-copy-id) without leaving the app.
- No dependency on the presence/version of the system OpenSSH client.

## Crate choice

`russh` 0.62, pure-Rust crypto. **Backend = `ring`**: russh defaults to
`aws-lc-rs`, whose Windows build requires NASM — an extra build-machine
dependency we don't want. Cost: ≈ +2.8 MB exe / +1 MB installer. tokio is
already in the tree (WS relay).

```toml
russh = { version = "0.62", default-features = false, features = ["ring", "rsa", "flate2"] }
```

## Architecture

The relay hub (`relay.rs`) only needs a blocking `Read`/`Write` byte pair
per session (`register_session`). An embedded SSH session is just another
byte-pipe producer — the frontend, dead-mode reconnect, AI sharing, and
link detection all work untouched.

```
xterm ──WS──► relay hub ──mpsc──► tokio task ──channel.data()──► SSH server
xterm ◄─WS── relay hub ◄─Read adapter◄─ ChannelMsg::Data ◄──────┘
```

- `ssh_spawn_embedded(spec, promptTabId?)` — full lifecycle: TCP connect (15 s timeout)
  → handshake with host-key check → auth chain → `channel_open_session` →
  `request_pty(xterm-256color)` → `request_shell` → bridge tasks → relay
  registration with dead-mode hooks.
- **Resize** — `pty_resize` dispatches SSH sessions to
  `channel.window_change`. **Kill** — drop handle + cancel bridge tasks.
- Channel EOF/Close ends the stream → relay dead mode → Enter respawns via
  the stored spec (+ cached password).

## Host key verification

`russh::keys::known_hosts` against `~/.ssh/known_hosts`
(OpenSSH-compatible, shared with the fallback path):

- known & matching → proceed silently;
- unknown → `ssh-hostkey-request` event (fingerprint shown) → frontend
  confirm → accept learns the key (TOFU);
- **mismatch** → same dialog with a loud warning; on accept the stale
  lines are removed before re-learning.

## Auth chain (per connect, in order)

1. Pageant agent (Windows) — try each identity;
2. `IdentityFile` from the resolved ssh config (else `~/.ssh/id_ed25519`,
   `id_ecdsa`, `id_rsa`); encrypted keys prompt for a passphrase (3 tries);
3. password prompt (3 tries).

Secret prompts are event-driven: backend emits `ssh-auth-request` `{reqId,
kind, prompt, sessionId?}` and parks on a oneshot; the frontend
(`src/terminal/sshauth.ts`) answers with `ssh_auth_response`. When
`sessionId` matches an on-screen embedded SSH tab, the secret is collected
**in that tab's xterm** (no echo; Enter submits; Esc/Ctrl+C cancel). No
tab (Settings key-install) falls back to the password modal. A password
that worked is cached **in memory only** so dead-mode reconnect re-auths
without re-prompting. Host-key confirmation stays a modal.

## Port forwarding

State per session: `forwards: {forwardId → kind, listen, target}`.

- `ssh_forward_add` → returns the `forward_id`. **Callers must store it
  back onto any local row** — removal addresses the backend by id.
- **local (-L)**: tokio `TcpListener`; each accepted socket opens
  `channel_open_direct_tcpip(target)` and bridges.
- **remote (-R)**: `handle.tcpip_forward(listen)`; the client handler's
  `server_channel_open_forwarded_tcpip` connects to the target locally.
- **dynamic (-D)**: minimal SOCKS5 listener (no-auth, CONNECT) bridging
  each connection to a direct-tcpip channel.
- `ssh_forward_remove` / `ssh_forward_list`; forwards are re-applied after
  a dead-mode respawn (`reapply_forwards`).
- **Config-defined forwards** (LocalForward / RemoteForward /
  DynamicForward in a host block) are applied on connect by
  `TabManager._applyConfigForwards` — they appear in the quick panel like
  runtime ones; deleting them from the panel does not touch the config and
  they return on reconnect.
- **External ssh (system OpenSSH) cannot be managed** — `pty_spawn_ssh` is
  a bare child with no ControlMaster. The UI hides the feature on those
  tabs (context-menu item + quick-panel block suppressed; the forwarding
  dialog probes `ssh_forward_list` first and toasts instead of opening).
  By design, not a key scenario; config forwards still work there because
  OpenSSH reads `~/.ssh/config` itself.

### Forward table UI (`src/ui/forwardtable.ts`)

One table component, two modes: **full** (Settings host editor — pinned
`127.0.0.1 :` listen prefix, inline edit) and **compact** (quick panel —
single line `[Port] │ [Host]:[Port] [+]`, SVG icon buttons, vertical
divider, listen column fixed to the port-input width so committed rows
align with the input row). The directional two-column editor
(`src/ui/forwardeditor.ts`) serves the tab context-menu dialog. Target
host is optional everywhere and defaults to 127.0.0.1.

## Key management (ssh-copy-id built in)

- `ssh_keygen` — Ed25519 / RSA-4096, optional passphrase (encrypted
  OpenSSH private key), refuses to overwrite, 0600 on unix. RNG: ssh-key
  0.7 needs rand_core 0.10 `CryptoRng`; `OsRng` no longer exists there, so
  a tiny infallible wrapper over `getrandom::fill` serves.
- `ssh_list_keys` — key pairs in ~/.ssh (orphan .pub files skipped), with
  SHA256 fingerprints.
- `ssh_install_pubkey` — connect (same host-key + auth chain as sessions),
  then probe the remote shell in order: `$PSVersionTable` (powershell) →
  `ver` (cmd) → `sh -c "uname -s"`; first exit-0 wins. sh is probed LAST
  on purpose: the powershell/cmd probes can only be answered by the
  default shell itself, but on Windows hosts with Git for Windows the
  default shell spawns sh.exe from PATH and answers the sh probe too
  (MINGW64_NT) — sh-first misclassified those as Posix, and the
  `&&`-chained POSIX prepare is a syntax error on PowerShell 5.1.
  `target_os` ("windows"/"linux"/"macos") narrows the probe list. Per
  shell family: prepare `~/.ssh` + `authorized_keys`, dedup-check, append.
  Key comments are stripped to "algo base64" before upload (free-form
  comments break shell quoting). Windows targets: administrator accounts
  may require `administrators_authorized_keys` — the UI warns; we don't
  write ProgramData.
- **Gotcha — exec EOF race**: sshd delivers a fast command's stdout EOF
  BEFORE it reaps the process and sends exit-status. `exec_capture` must
  read until channel Close; breaking on Eof loses the exit status randomly
  and made shell detection fail flakily. The in-process test server
  reproduces the sshd ordering (eof → exit-status → close).

## Frontend

- `src/terminal/sshauth.ts` — global event listeners. Password/passphrase
  for an on-screen embedded SSH tab is collected in that tab's xterm;
  Settings key-install (no tab) uses the password modal. Host-key confirm
  is always a modal. Started in `main.ts` — prompts work app-wide.
- `tabmanager.createSshTab` — with `sshEmbedded` on, opens the tab first
  (so the prompt has somewhere to go), then resolves the host via the
  frontend ssh-config parser (single source of truth — **no second
  parser**) and calls `ssh_spawn_embedded`. Off → `pty_spawn_ssh`.
- Settings → SSH: host editor modal (`sshhosteditor.ts`), key section
  (`sshkeys.ts`: generate/list/copy/install modals), per-host "Upload SSH
  Key".
- Tab context menu → "Port Forwarding…" + quick-panel forwards block; both
  go through `src/terminal/forwarding.ts` (single home of invoke calls +
  error toasts).

## Tests

- Rust: in-process `russh::server` integration tests — connect/auth/shell
  roundtrip, `window_change`, local forward roundtrip, SOCKS5 roundtrip,
  keygen (loadable, permissions, passphrase round-trip), install probing
  against simulated posix/cmd/powershell shells with the sshd message
  ordering. No external SSH server needed.
- Frontend: sshauth dialogs + in-terminal secret collect, forwarding dialog,
  quick-panel table, settings key UI (mocked invoke/events).
- Real-host smoke (connectivity, `-L` banner read, key install + cleanup)
  is a manual checklist against a throwaway VM.

## Out of scope

ProxyJump/ProxyCommand, X11/agent forwarding UI, certificate auth UI.
Sessions whose config needs these should use the fallback toggle.
