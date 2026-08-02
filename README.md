<p align="center">
  <img src="https://raw.githubusercontent.com/rede97/tterm/main/src/assets/tterm.svg" width="128" alt="TTerm" />
</p>

<h1 align="center">TTerm</h1>

<p align="center">
  A next-generation fast &amp; lightweight terminal for Windows — built for AI agents.<br/>
  Cold start in under a second · CJK/IME input that works in agent TUIs · serial tuned for embedded engineers.
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
- **Fast** — cold start under 1 second, ~5 MB installer, under 30 MB idle
  memory. No Electron bloat.
- **CJK input that works in agent TUIs** — terminals that hide the hardware
  cursor (pi, Claude Code and friends) lose your IME composition: pinyin
  vanishes or lands in a far corner. TTerm floats the composition right at
  the input point, candidate window alongside, gone the instant you commit —
  typing Chinese in an agent feels as direct as in a plain shell.
- **SSH, one click to any host** — reads your `~/.ssh/config`; connect
  instantly, no server setup needed.
- **Start right in your working directory** — Shift+click the `+` to pick a
  folder, or right-click it for recent folders; the default shell opens
  there, ready for agent work in a project (pi, Claude Code…). Installed via
  NSIS? Right-click any folder in Explorer → **Open in TTerm**.

### For embedded engineers

- **Serial, done right** — automatic device enumeration (USB VID:PID),
  one-click sessions, live baud switching without reconnecting, newline
  modes (fix staircase LF or overwriting CR output), input modes (direct /
  local echo / line editing), and per-device memory keyed by VID:PID.
- **Reconnect in a keystroke** — when a session drops, press Enter and it comes back.

### For everyone

- **Theme gallery** — 12 built-in schemes plus automatic Windows Terminal
  import, all previewed in your actual terminal font.

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
| Installer | ~5 MB | ~60 MB+ |
| Cold start | < 1s | ~3-5s |
| Idle memory | < 30 MB | ~150 MB+ |

## Build from source

```sh
bun install
bun run tauri build
```

Stack: Tauri v2 (Rust) + xterm.js, terminal I/O over a local WebSocket loopback.
Dev and testing docs live in [docs/testing.md](docs/testing.md).

## Roadmap

- [x] ~~**AI session sharing**~~ — hand any live session (shell / SSH / serial) to a local AI agent over a scoped, revocable link: the agent opens the link, reads how it works, pulls character-level screen snapshots (no screenshots, no OCR, TUI-aware) and types keystrokes. You watch every move in real time and cut it off with one click. ([design + agent integration guide](docs/ai-session-sharing.md))
- [ ] Split panes
- [ ] Custom color scheme editor
- [x] ~~Serial terminal~~ · ~~Session reconnect~~ · ~~Theme system~~ · ~~OSC 9;4 progress~~

## License

MIT
