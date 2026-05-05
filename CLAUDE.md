# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Runtime

Prefer **Bun** over npm/node for all package scripts (faster installs, faster dev server). The project still supports npm as fallback, but `bun run` is the default.

## Project

A multi-tab desktop terminal emulator built with Tauri v2. The frontend is vanilla TypeScript + Vite using xterm.js to render terminals. The Rust backend spawns native shells via PTY (pseudo-terminal) and pipes I/O between each shell and its corresponding tab.

## Commands

```sh
bun run dev          # Start Vite dev server (frontend only)
bun run build        # Typecheck + build frontend
bun run tauri dev    # Start full Tauri app in dev mode
bun run tauri build  # Build production Tauri binary
```

Use `bun` for running scripts; fall back to `npm run` if bun is unavailable.

There are no tests or linters configured yet.

## Architecture

### Frontend (`src/`, `index.html`)

- `index.html` — `#tab-bar` (tabs container + new-tab button) + `#terminal-container`
- `src/main.ts` — `Tab` interface, `tabs: Map<string, Tab>`, `createTab()`/`switchTab()`/`closeTab()`. On load auto-calls `pty_spawn` for the initial tab. Routes `pty-output` events by `payload.id` to the correct terminal instance.
- `src/styles.css` — VS Code-style tab bar (#252526), dark terminal theme (#1e1e1e), unified scrollbar styling

### Backend (`src-tauri/`)

- `src-tauri/src/main.rs` — entry point, calls `tterm_lib::run()`
- `src-tauri/src/lib.rs` — Tauri builder setup, PTY session management

### PTY session model (`lib.rs`)

- `AppState` holds `HashMap<String, PtySession>` + `next_id` counter
- `PtySession` stores the PTY `master` (for resize) and `writer` (for write)
- Each tab spawns a dedicated shell process and background read thread

### Communication model

Frontend → Backend: Tauri `invoke()` commands:

| command | args | purpose |
|---|---|---|
| `pty_spawn` | — | create tab, return `"tab-N"` id |
| `pty_write` | `id`, `data` | write keystrokes to tab's PTY |
| `pty_resize` | `id`, `cols`, `rows` | notify PTY of terminal resize |
| `pty_kill` | `id` | kill tab's shell, remove session |

Backend → Frontend: Tauri events (`pty-output`)

| event | payload | purpose |
|---|---|---|
| `pty-output` | `{ id: string, data: number[] }` | shell output routed to correct tab |

User keystrokes go `xterm.js` → `pty_write` invoke → Rust writes to PTY stdin.
Shell output goes PTY stdout → Rust reads → `pty-output` event → `term.write()`.

## Key dependencies

- Frontend: `@xterm/xterm`, `@xterm/addon-fit`, `@tauri-apps/api`
- Backend: `tauri` v2, `portable-pty` (cross-platform PTY)

## Platform notes

On Windows, the shell is `cmd.exe`. On Unix, it's the user's `$SHELL` (fallback `/bin/sh`). `portable-pty` abstracts PTY resize and process handling across platforms. The Vite dev server binds `127.0.0.1` explicitly (not `::1`) because IPv6 loopback has connectivity issues on Windows.
