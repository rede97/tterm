<p align="center">
  <img src="https://raw.githubusercontent.com/rede97/tterm/main/src/assets/tterm.svg" width="128" alt="TTerm" />
</p>

<h1 align="center">TTerm</h1>

<p align="center">
  A fast, tiny, focused terminal for Windows.<br/>
  Local shells, SSH, and serial — all in a ~5 MB installer.
</p>

<p align="center">
  <a href="https://github.com/rede97/tterm/actions/workflows/ci.yml"><img src="https://github.com/rede97/tterm/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://github.com/rede97/tterm/releases/latest"><img src="https://img.shields.io/github/v/release/rede97/tterm" alt="Release" /></a>
  <a href="https://github.com/rede97/tterm/blob/main/LICENSE"><img src="https://img.shields.io/github/license/rede97/tterm" alt="License" /></a>
</p>

<p align="center">
  <img src="docs/images/screenshot.png" width="820" alt="TTerm screenshot" />
</p>

> [中文](README_CN.md)

## Why TTerm

- **Fast** — cold start under 1 second. No Electron bloat.
- **Tiny** — ~5 MB installer, under 30 MB idle memory.
- **CJK input that works in agent TUIs** — terminals that hide the hardware
  cursor (pi, Claude Code and friends) lose your IME composition: pinyin
  vanishes or lands in a far corner. TTerm floats the composition right at
  the input point, candidate window alongside, gone the instant you commit —
  typing Chinese in an agent feels as direct as in a plain shell.
- **Serial, done right** — for hardware hackers: automatic device enumeration
  (USB VID:PID), one-click sessions, live baud switching without reconnecting,
  newline modes (fix staircase LF or overwriting CR output), input modes
  (direct / local echo / line editing), and per-device memory keyed by VID:PID.
- **SSH built in** — reads your `~/.ssh/config`, one click to any host.
- **Reconnect in a keystroke** — when a session drops, press Enter and it comes back.
- **Theme gallery** — 12 built-in schemes plus automatic Windows Terminal
  import, all previewed in your actual terminal font.

<p align="center">
  <img src="docs/images/screenshot-profiles.png" width="410" alt="Profile menu: local shells, SSH hosts, serial ports" />
  <img src="docs/images/screenshot-themes.png" width="410" alt="Theme gallery in Settings" />
</p>

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

- [ ] **AI session sharing** — hand any live session (shell / SSH / serial) to a local AI agent over a scoped, revocable WebSocket link; you watch every keystroke in real time and cut it off with one click. No screenshots, no OCR — the agent gets the raw byte stream. ([design + agent integration guide](docs/ai-session-sharing.md))
- [ ] Split panes
- [ ] Custom color scheme editor
- [x] ~~Serial terminal~~ · ~~Session reconnect~~ · ~~Theme system~~ · ~~OSC 9;4 progress~~

## License

MIT
