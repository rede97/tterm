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

- `index.html` — `#tab-bar` (tabs, new-tab button, drag-spacer, window controls) + `#terminal-container`
- `src/main.ts` — `Tab` interface, `tabs: Map<string, Tab>`. On load: fetches SSH hosts, Windows Terminal profiles, VS instances, and config. Routes `pty-output` events by `payload.id` to the correct terminal instance.
- `src/styles.css` — VS Code-style tab bar (#252526), dark terminal theme (#1e1e1e), unified scrollbar styling

### Backend (`src-tauri/`)

- `src-tauri/src/main.rs` — entry point, calls `tterm_lib::run()`
- `src-tauri/src/lib.rs` — Tauri builder setup, PTY session management, SSH config parsing, VS instance discovery, config persistence

### PTY session model (`lib.rs`)

- `AppState` holds `HashMap<String, PtySession>` + `next_id` counter
- `PtySession` stores the PTY `master` (for resize) and `writer` (for write)
- Each tab spawns a dedicated shell process and background read thread

### Communication model

Frontend → Backend: Tauri `invoke()` commands:

| command | args | purpose |
|---|---|---|
| `pty_spawn` | `command?` | create tab, return `"tab-N"` id. No command = default shell |
| `pty_spawn_ssh` | `hostname`, `port`, `user` | create SSH tab |
| `pty_write` | `id`, `data` | write keystrokes to tab's PTY |
| `pty_resize` | `id`, `cols`, `rows` | notify PTY of terminal resize |
| `pty_kill` | `id` | kill tab's shell, remove session |
| `window_minimize` | — | minimize the window |
| `window_toggle_maximize` | — | toggle maximize/restore |
| `window_close` | — | close the window |
| `window_start_drag` | — | start window drag |
| `read_wt_settings` | — | return raw Windows Terminal settings.json content |
| `find_vs_instances` | — | discover VS installations via vswhere/known paths |
| `read_config` | — | read app config from `{app_config_dir}/config.json` |
| `write_config` | `content` | write JSON string to app config file |
| `ssh_list_hosts` | — | parse `~/.ssh/config`, return host list |

Backend → Frontend: Tauri events (`pty-output`)

| event | payload | purpose |
|---|---|---|
| `pty-output` | `{ id: string, data: number[] }` | shell output routed to correct tab |

User keystrokes go `xterm.js` → `pty_write` invoke → Rust writes to PTY stdin.
Shell output goes PTY stdout → Rust reads → `pty-output` event → `term.write()`.

## Key dependencies

- Frontend: `@xterm/xterm`, `@xterm/addon-fit`, `@tauri-apps/api`
- Backend: `tauri` v2, `portable-pty` (cross-platform PTY), `serde`, `serde_json`
- Icons: `lucide` (MIT-licensed SVG icon library, stroke-based, consistent 2px weight)

## Profile loading flow

1. **SSH** — Rust reads `~/.ssh/config`, parses Host entries with wildcard inheritance
2. **Windows Terminal profiles** — Rust reads WT's `settings.json` (raw content), sends to frontend. Frontend parses `profiles.list`, handles `source: "Windows.Terminal.VisualStudio"` by resolving via vswhere-discovered VS instances
3. **Default profile** — Config persisted in `{app_config_dir}/config.json`. Priority: user-set default → first profile → cmd.exe fallback

## Profile dropdown menu

Two-column layout (Local | SSH) with a vertical divider. Centered below the new-tab menu button, flips on overflow. Each profile item has a Lucide icon, label, optional detail text, and click-to-launch.

## Fit tolerance (resize flicker prevention)

`applyFit()` uses `proposeDimensions()` (read-only) to get suggested dimensions, applies 10% char-height tolerance before shrinking rows/cols. This prevents grid resize oscillation from sub-pixel overflow. On tab switch, only `applyFit` is called (no PTY resize IPC) — size hint overlay only appears on window resize.

## Custom window decorations

The app runs without native title bar (`decorations: false` in tauri.conf.json). The tab bar (`#tab-bar`) serves as the title bar with:
- Tabs on the left, new-tab button with dropdown menu adjacent
- `#drag-spacer` with `data-tauri-drag-region` fills center
- `#window-controls` (minimize/maximize/close) on the right with Lucide SVG icons

Window dragging: `mousedown` on tab bar registers `mousemove` listener. Only if the mouse actually moves does it call `window_start_drag`. On `mouseup` without movement the listeners clean up — this defers drag so `dblclick` on the tab bar can still toggle maximize.

Maximize/restore icon toggle: `#btn-maximize` holds two Lucide icons (`.ico-max` Square, `.ico-restore` Copy). The `updateMaximizeIcon()` function checks `appWindow.isMaximized()` and toggles the `.restore` CSS class, which swaps visibility via `display: none/block`.

## xterm.js v6 scrollbar

xterm.js v6 uses a custom DOM scrollbar (`.xterm-scrollable-element > .scrollbar > .scra`), not native `::-webkit-scrollbar`. The `.xterm-viewport` must keep `overflow-y: scroll` for scrolling to work — setting `overflow: hidden` will clip terminal content. Native scrollbars inside `.terminal-instance` are hidden via `::-webkit-scrollbar { display: none }`, so only the styled DOM scrollbar is visible. The tab bar uses a wheel event listener to map vertical scroll → horizontal `scrollLeft`.

## File editing

Use **PowerShell** (`Set-Content` / `Get-Content`) for file edits. The Edit tool frequently fails to match strings in this repo because Read tool output may not byte-match the actual file content (tab/space rendering, line ending normalization). PowerShell text replacement is reliable. Only use the Edit tool for trivial single-line changes.

## Platform notes

On Windows, the default shell is `cmd.exe`. On Unix, it's the user's `$SHELL` (fallback `/bin/sh`). `portable-pty` abstracts PTY resize and process handling across platforms. The Vite dev server binds `127.0.0.1` explicitly (not `::1`) because IPv6 loopback has connectivity issues on Windows. Windows Terminal settings are read from `%LOCALAPPDATA%\Packages\Microsoft.WindowsTerminal_*\LocalState\settings.json` (also checks Preview and unpackaged paths). VS instances are discovered via `vswhere.exe` with a fallback to scanning common `Program Files` paths.
