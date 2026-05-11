# TTerm

A Windows terminal emulator built with Tauri v2 + xterm.js. Optimized for small binary size, high performance, and low resource usage. Focuses on the terminal content, not flashy UI.

> [中文](README_CN.md)

## Philosophy

Hyper (Electron) is bloated — large install size, high memory usage, slow startup. It also suffers from excessive terminal padding, broken IME input, and color scheme overrides. Windows Terminal is decent but hard to extend; common tasks like SSH and serial connections require too many clicks.

TTerm strips away the excess. Three priorities: **fast controls**, **clean terminal display**, **instant startup**.

## Features

- **Multi-tab terminal** — unlimited tabs supporting local shells (cmd.exe / PowerShell) and SSH connections
- **SSH config integration** — auto-parses `~/.ssh/config` for one-click remote host connections
- **Windows Terminal import** — reads WT `settings.json` to reuse existing profiles, including VS Developer Prompt / PowerShell
- **Admin mode** — hold Shift when clicking a profile to launch elevated, or right-click a tab to duplicate as admin
- **Tab context menu** — right-click to rename, recolor, duplicate, export text, close right/other tabs
- **In-terminal search** — Ctrl+Shift+F to open the find bar
- **Custom window decorations** — no native title bar; VS Code-style tab bar with integrated window controls
- **Persistent config** — default terminal type and other settings preserved across sessions

## Performance

| Metric | TTerm (Tauri) | Hyper (Electron) |
|--------|---------------|-------------------|
| Installer | ~5 MB | ~60 MB+ |
| Cold start | < 1s | ~3-5s |
| Idle memory | < 30 MB | ~150 MB+ |

## Tech Stack

- **Frontend**: TypeScript + Vite + xterm.js v6 + Lucide Icons
- **Backend**: Rust + Tauri v2 + portable-pty
- **IPC**: Tauri invoke/event bridge; PTY I/O streamed via events
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

- [ ] Serial port support
- [ ] Telnet protocol support
- [ ] Split panes
- [ ] Custom color scheme configuration UI
- [ ] Session recording and replay

## License

MIT
