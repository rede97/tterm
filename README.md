<p align="center">
  <img src="https://raw.githubusercontent.com/rede97/tterm/main/src/assets/tterm.svg" width="128" alt="TTerm" />
</p>

<h1 align="center">TTerm</h1>

<p align="center">
  A next-generation fast &amp; lightweight terminal for Windows, purpose-built for AI agent workflows —<br/>
  with Chinese IME input done right.<br/>
  Cold start in under a second · hand any live session to your AI agent in one click ·
  Chinese input that keeps working where other terminals lose it · serial tuned for embedded engineers.
</p>

<p align="center">
  <a href="https://github.com/rede97/tterm/actions/workflows/ci.yml"><img src="https://github.com/rede97/tterm/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://github.com/rede97/tterm/releases/latest"><img src="https://img.shields.io/github/v/release/rede97/tterm" alt="Release" /></a>
  <a href="https://github.com/rede97/tterm/blob/main/LICENSE"><img src="https://img.shields.io/github/license/rede97/tterm" alt="License" /></a>
</p>

> [中文](README_CN.md)

## Why TTerm

### For AI agent workflows

- **Hand a live session to your AI agent** — right-click a tab → *Share with
  AI*, paste the link to any local agent. The link teaches the agent how to
  use it: it pulls character-level screen snapshots (no screenshots, no OCR,
  TUI-aware — it even knows where the fake cursor is) and can type for you,
  while you watch every move in real time. One click revokes everything;
  nothing ever leaves 127.0.0.1. ([protocol](docs/ai-session-sharing.md))
- **CJK input that works in agent TUIs** — terminals that hide the hardware
  cursor (pi, Claude Code and friends) lose your IME composition: pinyin
  vanishes or lands in a far corner. TTerm floats the composition right at
  the input point, candidate window alongside, gone the instant you commit —
  typing Chinese in an agent feels as direct as in a plain shell.
- **Fast** — cold start under 1 second, ~7 MB installer, under 30 MB idle
  memory. No Electron bloat.
- **SSH, one click to any host** — reads your `~/.ssh/config`; connect
  instantly, no server setup needed. The built-in client asks for passwords
  and host-key trust in proper dialogs (known_hosts stays shared with
  OpenSSH), local/remote/SOCKS5 port forwards can be added live mid-session,
  and Settings can generate key pairs and install a public key on any host
  (ssh-copy-id built in, Linux/macOS/Windows targets).
- **Start right in your working directory** — Shift+click the `+` to pick a
  folder, or right-click it for recent folders; the default shell opens
  there, ready for agent work in a project (pi, Claude Code…). Installed via
  NSIS? Right-click any folder in Explorer → **Open in TTerm**.

### For embedded engineers

- **Serial, done right** — automatic device enumeration (USB VID:PID),
  one-click sessions, live baud switching without reconnecting, newline
  modes (fix staircase LF or overwriting CR output), input modes (direct /
  local echo / line editing), and session behavior presets via serial
  profiles.
- **Sleep-proof sessions** — put the laptop to sleep, wake it, and the shell is
  still there. A dropped transport is re-attached silently in the background —
  no dialog, no lost scrollback. And when a session truly ends (shell exit,
  unplugged serial), the reconnect prompt is printed *inside* the terminal:
  press Enter to respawn — no focus hunt, no modal in the way.

### For everyone

- **Quick-status button** — at the right end of the tab bar: session state
  at a glance (red dot = down, blue = AI-shared), one toggle for AI share,
  SSH auto-reconnect and port forwards, serial baud/RTS/CTS — all two
  clicks away.
- **Theme gallery** — 12 built-in schemes, automatic Windows Terminal
  import, and a custom theme editor with live preview — all previewed in
  your actual terminal font.

| Main window | New-tab menu |
| :---: | :---: |
| <img src="docs/images/screenshot.png" width="410" alt="Main window" /> | <img src="docs/images/screenshot-profiles.png" width="410" alt="New-tab menu: local shells, SSH hosts, serial ports" /> |
| Theme gallery | Launch in any folder |
| <img src="docs/images/screenshot-themes.png" width="410" alt="Theme gallery in Settings" /> | <img src="docs/images/screenshot-browse.png" width="410" alt="Folder picker + recent folders — a shell starts in the chosen working directory" /> |

## Download

Grab the installer (NSIS / MSI) from [Releases](https://github.com/rede97/tterm/releases/latest).

## Performance

| Metric | TTerm (Tauri) | Hyper (Electron) |
|--------|---------------|-------------------|
| Installer | ~7 MB | ~60 MB+ |
| Cold start | < 1s | ~3-5s |
| Idle memory | < 30 MB | ~150 MB+ |

## Build from source

```sh
bun install
bun run tauri build
```

Stack: Tauri v2 (Rust) + xterm.js, terminal I/O over a local WebSocket loopback.
Dev and testing docs live in [docs/testing.md](docs/testing.md).

## License

MIT
