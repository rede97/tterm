# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

A desktop terminal emulator built with Tauri v2. The frontend is vanilla TypeScript + Vite using xterm.js to render the terminal. The Rust backend spawns a native shell via PTY (pseudo-terminal) and pipes I/O between the shell and the frontend.

## Commands

```sh
npm run dev          # Start Vite dev server (frontend only)
npm run build        # Typecheck + build frontend
npm run tauri dev    # Start full Tauri app in dev mode
npm run tauri build  # Build production Tauri binary
```

There are no tests or linters configured yet.

## Architecture

### Frontend (`src/`, `index.html`)

- `index.html` — minimal shell, just `<div id="terminal">`
- `src/main.ts` — creates the xterm.js `Terminal` with `FitAddon`, wires up the Tauri event bridge
- `src/styles.css` — full-window dark terminal styling

### Backend (`src-tauri/`)

- `src-tauri/src/main.rs` — entry point, calls `tterm_lib::run()`
- `src-tauri/src/lib.rs` — Tauri builder setup, command handlers, PTY management

### Communication model

Frontend → Backend: Tauri `invoke()` commands (`pty_write`, `pty_resize`)
Backend → Frontend: Tauri events (`pty-output`)

User keystrokes go `xterm.js` → `pty_write` invoke → Rust writes to PTY stdin.
Shell output goes PTY stdout → Rust reads → `pty-output` event → `term.write()`.

## Key dependencies

- Frontend: `@xterm/xterm`, `@xterm/addon-fit`, `@tauri-apps/api`
- Backend: `tauri` v2, `portable-pty` (cross-platform PTY)

## Platform notes

On Windows, the shell is `cmd.exe` (or `powershell.exe`). On Unix, it's the user's `$SHELL` (fallback `/bin/sh`). PTY resize and process exit handling differ per platform — `portable-pty` abstracts most of this.
