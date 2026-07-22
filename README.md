<p align="center">
  <img src="https://raw.githubusercontent.com/rede97/tterm/main/src/assets/tterm.svg" width="128" alt="TTerm" />
</p>

<h1 align="center">TTerm</h1>

<p align="center">
  <a href="https://github.com/rede97/tterm/actions/workflows/ci.yml"><img src="https://github.com/rede97/tterm/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
</p>

A Windows terminal emulator built with Tauri v2 + xterm.js. Optimized for small binary size, high performance, and low resource usage. Focuses on the terminal content, not flashy UI.

> [中文](README_CN.md)

## Philosophy

Hyper (Electron) is bloated — large install size, high memory usage, slow startup. It also suffers from excessive terminal padding, broken IME input, and color scheme overrides. Windows Terminal is decent but hard to extend; common tasks like SSH and serial connections require too many clicks.

TTerm strips away the excess. Three priorities: **fast controls**, **clean terminal display**, **instant startup**.

## Features

- **Multi-tab terminal** — unlimited tabs supporting local shells (cmd.exe / PowerShell) and SSH connections, with drag-to-reorder
- **SSH config integration** — auto-parses `~/.ssh/config` for one-click remote host connections
- **Windows Terminal import** — reads WT `settings.json` and fragments to reuse existing profiles (VS, WSL, Azure, Git Bash, MSYS2)
- **Profile visibility control** — toggle imported profiles on/off in settings without losing them
- **Tab context menu** — right-click to new tab, rename, recolor, duplicate, export text, close right/other tabs
- **Terminal context menu** — shift+right-click for copy (plain/HTML), paste, clear, find, export, new tab
- **In-terminal search** — Ctrl+Shift+F to open the find bar
- **Settings panel** — General, Appearance, and Profile tabs with renderer selection, scrollback buffer, paste options, tab width mode
- **Custom window decorations** — no native title bar; VS Code-style tab bar with integrated window controls
- **Open in new window** — launch additional app windows from context menu
- **Serial terminal** — auto-detects serial devices (USB VID/PID, manufacturer) and opens sessions in one click (115200 8N1 default, configurable baud)
- **Color schemes** — 12 built-in themes (Solarized, Dracula, Nord, Gruvbox, Monokai, etc.), auto-imports custom Windows Terminal schemes, live preview in settings
- **Persistent config** — all settings preserved across sessions

## Performance

| Metric | TTerm (Tauri) | Hyper (Electron) |
|--------|---------------|-------------------|
| Installer | ~5 MB | ~60 MB+ |
| Cold start | < 1s | ~3-5s |
| Idle memory | < 30 MB | ~150 MB+ |

## Tech Stack

- **Frontend**: TypeScript + Vite + xterm.js v6 + Lucide Icons
- **Backend**: Rust + Tauri v2 + portable-pty
- **IPC**: Tauri invoke commands + local WebSocket loopback (binary PTY I/O streamed directly to xterm.js)
- **Packaging**: NSIS installer (~5 MB)

## Development

```sh
# Install dependencies
bun install

# Frontend dev server
bun run dev

# Full Tauri dev mode
bun run tauri dev

# Production build
bun run tauri build
```

## Roadmap

- [x] Serial port support
- [ ] Split panes
- [~] Custom color scheme configuration UI (built-in themes + WT scheme import done; custom editor pending)
- [ ] Session recording and replay
- [x] OSC 9;4 terminal progress bar in tab title

## License

MIT
