<p align="center">
  <img src="docs/images/logo.svg" width="96" alt="TTerm" />
</p>

<h1 align="center">TTerm</h1>

<p align="center">
  <strong>A lightweight, fast Windows task terminal redesigned for development work in the AI agent era.</strong><br/>
  It carries local, remote, and device workflows—not merely a tool.<br/>
  Jump into any local, SSH, or serial session. Chinese input and agent TUIs work together. Cold start under a second.
</p>

<p align="center">
  <a href="https://github.com/rede97/tterm/releases/latest"><strong>Download for Windows</strong></a>
  ·
  <a href="README.md">中文</a>
</p>

<p align="center">
  <a href="https://github.com/rede97/tterm/actions/workflows/ci.yml"><img src="https://github.com/rede97/tterm/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://github.com/rede97/tterm/releases/latest"><img src="https://img.shields.io/github/v/release/rede97/tterm" alt="Release" /></a>
  <a href="https://github.com/rede97/tterm/blob/main/LICENSE"><img src="https://img.shields.io/github/license/rede97/tterm" alt="License" /></a>
</p>

<!-- Demo clips: drop GIFs at these paths, then uncomment.
     docs/images/hero.gif      cold start + palette + new session
     docs/images/share.gif     Share with AI
     docs/images/sessions.gif  local / SSH / serial
<p align="center">
  <img src="docs/images/hero.gif" width="880" alt="TTerm" />
</p>
<p align="center">
  <img src="docs/images/share.gif" width="430" alt="Share with AI" />
  &nbsp;
  <img src="docs/images/sessions.gif" width="430" alt="Local, SSH, and serial" />
</p>
-->

<p align="center"><em>Demo GIFs coming. Screenshots below are placeholders until those clips land.</em></p>

| Terminal and agent | Local, SSH, and serial |
| :---: | :---: |
| <img src="docs/images/screenshot.png" width="410" alt="CLI AI agent running in TTerm" /> | <img src="docs/images/screenshot-profiles.png" width="410" alt="Local shells, SSH hosts, and serial devices" /> |
| Themes and fonts | Start from a project directory |
| <img src="docs/images/screenshot-themes.png" width="410" alt="TTerm theme and font settings" /> | <img src="docs/images/screenshot-browse.png" width="410" alt="Choose a project or recent directory" /> |

## Why TTerm

### Light, and fast

Cold start under 1 second. Installer around 7 MB. Idle memory under 30 MB. Built for development work on Windows—not another traditional terminal with a longer feature list.

### Three session kinds, one workflow

Local shells, SSH, and serial are first-class tabs: same create, switch, reconnect, and share paths. Sleep or a short drop reconnects silently and keeps scrollback.

### Let AI see the live session

**Share with AI** hands a running session to a local agent as character-level screen state (scroll regions, color, cursor, TUIs)—not a screenshot or OCR. With permission, the agent can type back. The share server listens only on `127.0.0.1`. Protocol: [session sharing](docs/ai-session-sharing.md).

Agent TUIs often hide the cursor; Windows IMEs then lose the composition string and candidate window. TTerm rebuilds composition next to the input cell so Chinese (and Japanese / Korean) typing stays usable inside hidden-cursor TUIs.

### Ready out of the box

Bundled themes and monospace fonts, plus a built-in SSH client. Existing `~/.ssh/config` hosts connect immediately—no extra toolchain to install.

### Keyboard-first, command-style

Switch tabs, open sessions, and change serial or forwarding settings from the command palette. Defaults follow VS Code habits (`Ctrl+Shift+P` / `Ctrl+P` / `Ctrl+Tab`). You can work without the mouse.

## Features

- **Local** — Windows Terminal profiles; shells from a chosen directory; Explorer **Open in TTerm**
- **SSH** — built-in client; reads `~/.ssh/config`; passwords and passphrases typed in the tab; host-key dialog; local / remote / SOCKS5 forwarding
- **Serial** — auto-discovery (USB VID/PID); live baud changes; direct / echo / line input; flow control and RTS/CTS/DTR/DSR; profiles for input and newlines
- **Themes and fonts** — bundled palettes and monospace fonts, ready after install
- **Command palette** — `Ctrl+Shift+P`; `Ctrl+P` jumps to a tab; the rest is keyboard-operable
- **Session recovery** — silent reattach after sleep or a short transport drop
- **Low overhead** — Tauri + xterm.js; terminal bytes stay on a local WebSocket, not IPC

## Who it is for

Not only for Chinese users. Fast launch is already a better daily Windows terminal; **Share with AI** on a live SSH or serial session is a tool for ops and embedded engineers doing remote and device debug.

- CLI agents (Claude Code, Codex, Pi, …) as the main tool on Windows
- Developers and operators who need to jump into any local, SSH, or serial session
- Embedded engineers who want AI watching the same serial stream or remote logs
- Anyone who talks to agents in Chinese (or Japanese / Korean) and has hit Windows IME / TUI bugs
- VS Code keyboard habits, and a terminal that does not need the mouse
- Anyone who cares about startup time, memory, and keeping data on-box

## Download

Get the Windows installer (NSIS / MSI) from [Releases](https://github.com/rede97/tterm/releases/latest).

## Shortcuts

| Action | Default |
| --- | --- |
| Command palette | `Ctrl+Shift+P` |
| Go to tab | `Ctrl+P` |
| Recent tabs | `Ctrl+Tab` / `Ctrl+Shift+Tab` |
| New local tab | `Ctrl+T` |
| Close tab | `Ctrl+W` |
| Settings | `Ctrl+,` |
| Full screen / Zen | `F11` / `Shift+F11` |
| New window | `Ctrl+Shift+N` |

Rebind in Settings → Keyboard. Terminal find: **Shift+right-click** in the terminal.

## Build from source

```sh
bun install
bun run tauri build
```

Stack: Tauri v2 (Rust) + xterm.js. Development and tests: [docs/testing.md](docs/testing.md).

## License

[MIT](LICENSE)
