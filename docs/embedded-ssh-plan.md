# Embedded SSH client (russh) — design

Status: implemented in v0.9.0 cycle. Replaces spawning the system `ssh.exe`
via ConPTY for SSH tabs (the old path stays as a fallback toggle).

## Why

- **Dynamic port forwarding** — the headline win. A running session can
  add/remove local (`-L`) and remote (`-R`) forwardings at runtime through
  direct API calls (see below). With the spawned binary this required the
  fragile `~C` escape console or an external ControlMaster socket.
- Auth UX under our control: password / key-passphrase prompts and host-key
  confirmation become native dialogs instead of ConPTY stdin fights.
- No dependency on the presence/version of the system OpenSSH client.

## Crate choice

`russh` 0.62, pure-Rust crypto stack. **Backend = `ring`**:
russh defaults to `aws-lc-rs`, whose Windows build requires NASM — an extra
build-machine dependency we don't want. `ring` builds with zero extra tooling:

```toml
russh = { version = "0.62", default-features = false, features = ["ring", "rsa", "flate2"] }
```

Measured cost (release build, experiment in `experiments/ssh-size/`):
**+2.8 MB** on the exe, **≈ +1 MB** on the NSIS installer. tokio is already
in the tree (WS relay), so it contributes nothing extra.

## Architecture

The relay hub (`relay.rs`) only needs a blocking `Read`/`Write` byte pair per
session (`register_session`). An embedded SSH session is therefore just
another byte-pipe producer — the frontend, dead-mode reconnect, AI sharing,
and link detection all keep working untouched.

```
xterm ──WS──► relay hub ──mpsc──► tokio task ──channel.data()──► SSH server
xterm ◄─WS── relay hub ◄─Read adapter◄─ ChannelMsg::Data ◄──────┘
```

### `src-tauri/src/sshclient.rs` (new)

- `ssh_spawn_embedded(params)` command — full lifecycle:
  TCP connect (10 s timeout) → handshake with host-key check → auth chain →
  `channel_open_session` → `request_pty(xterm-256color, cols, rows)` →
  `request_shell` → register bridge with the relay (with dead-mode hooks).
- **Host key verification** — `russh::keys::known_hosts` against
  `~/.ssh/known_hosts` (OpenSSH-compatible, shared with the fallback path):
  - known & matching → proceed silently;
  - unknown → event `ssh-hostkey-request` (fingerprint shown) → frontend
    confirm → accept learns the key (`learn_known_hosts_path`, TOFU);
  - **mismatch** → same dialog with a loud warning; on accept the stale
    lines for the host are removed before re-learning.
- **Auth chain** (per connect, in order):
  1. Pageant agent (Windows) — `AgentClient::connect_pageant()`, try each
     identity via `authenticate_publickey_with`;
  2. `IdentityFile` from the resolved ssh config (else `~/.ssh/id_ed25519`,
     `id_rsa` defaults); encrypted keys prompt for a passphrase via dialog;
  3. password dialog, retried while the server keeps offering `password`.
  - Dialogs are event-driven: backend emits `ssh-auth-request`
    `{reqId, kind: "password"|"passphrase", prompt}`, parks on a oneshot,
    frontend answers with `ssh_auth_response {reqId, secret | null}`
    (null = user cancelled → abort connect).
  - A password that worked is cached **in memory only** so dead-mode
    Enter-to-reconnect can re-auth without re-prompting.
- **Bridge** — upstream: `Write` impl feeding an mpsc drained by a tokio task
  into `channel.data()`; downstream: tokio task forwards `ChannelMsg::Data`
  into a blocking `Read` adapter. Channel EOF/Close ends the stream → relay
  dead mode → Enter respawns via stored params (+ cached password).
- **Resize** — `pty_resize` dispatches SSH sessions to
  `channel.window_change`. **Kill** — drop handle + cancel bridge tasks.

### Dynamic port forwarding

State per session: forward table `{forwardId → kind, listen, target}`.

- `ssh_forward_add {id, kind, listenHost, listenPort, targetHost, targetPort}`
  - **local**: tokio `TcpListener` task; each accepted socket opens
    `channel_open_direct_tcpip(target…)` and bridges with
    `tokio::io::copy_bidirectional`. Equivalent to `-L`.
  - **remote**: `handle.tcpip_forward(listen…)`; the client Handler's
    `server_channel_open_forwarded_tcpip` connects to the target locally and
    bridges. Equivalent to `-R`.
- `ssh_forward_remove {id, forwardId}` — abort listener task /
  `cancel_tcpip_forward`.
- `ssh_forward_list {id}` — table contents.
- Forwardings are re-applied automatically after a dead-mode respawn.

### Frontend

- `src/terminal/sshauth.ts` — global event listeners + modal dialogs
  (password/passphrase input; host-key fingerprint confirm). Started in
  `main.ts`.
- `tabmanager.createSshTab` — when `configStore.get("sshEmbedded")`, resolves
  the host's `hostname`/`port`/`user`/`identityfile` from the existing
  frontend ssh-config parser (single source of truth — **no second parser**)
  and calls `ssh_spawn_embedded`. Toggle off → old `pty_spawn_ssh`.
- Settings → SSH panel: "Built-in SSH client" toggle (`sshEmbedded`,
  default on).
- SSH tab context menu → "Port Forwarding…" — modal listing active mappings
  with add (kind/listen/target) and remove. `src/terminal/forwarding.ts`.

## Tests

- Rust: blocking pipe-adapter roundtrip unit test; **in-process integration
  test** — a minimal `russh::server` (password auth, session channel with a
  PTY-less echo shell, `direct-tcpip` support) exercising connect → auth →
  shell I/O → `window_change` → local forward roundtrip. No external SSH
  server needed.
- Frontend: `sshauth` dialog logic and forwarding dialog (mocked
  invoke/events).
- Existing vitest + e2e suites must stay green.

## Out of scope (v1)

ProxyJump/ProxyCommand, SOCKS (`-D`), X11/agent forwarding, certificate
auth UI. Sessions whose config needs these should use the fallback toggle.
