# AGENTS.md

OpenCode guidance for working in this repository. High-signal, repo-specific facts only; skip obvious defaults.

## Runtime

Use **Bun** (`bun run <script>`). Fall back to `npm run` if unavailable.

```sh
bun run build        # tsc typecheck + vite build (always do this before committing)
bun run tauri dev    # full Tauri app in dev mode
bun run tauri build  # production binary
```

No tests or linters are configured.

## Architecture

### Tab system (`src/tab.ts`, `src/tabmanager.ts`)

- **`src/tab.ts`** — `TerminalTab` class. Each tab owns: terminal, xterm, DOM, color, index (`index`), search state (`searchQuery`), context menu handler. Key methods:
  - `show()` — `display:""`, add `active`, `terminal.focus()`
  - `hide()` — `display:"none"`, remove `active`, set `needsResize = true`
  - `fit()` — proposeDimensions + 10% tolerance + resize
  - `fitDeferred()` — double-rAF fit; aborts if `element.style.display === "none"`
  - `setColor()`, `rename()`, `destroy()` — self-explanatory

- **`src/tabmanager.ts`** — `TabManager` class (singleton: `tabManager`). Owns tab Map, active tab, settings, resize, new-tab button.
  - `switchTo(id)` — closes settings first if open; if same tab was hidden by settings, re-shows it
  - `toggleSettings()` — opens only (no-op if already open); close via tab close button or terminal tab click
  - `refreshBadges()` — queries `.tab[data-tab-id^="tab-"]` (skips `#settings`); sets `tab.index` per tab
  - `clearTab(id)` — calls `terminal.clear()`
  - `createTabElement()` — assigns `tab.tabElement = el` (property !-asserted)

- **`src/state.ts`** — `appState` is alias for `tabManager`. Do NOT add new state here.
- **`src/tabs.ts`** — DELETED.
- **`src/terminal.ts`** — ORPHANED (no imports).

### Circular dependencies: DO NOT introduce

- `tab.ts` must NEVER import `tabmanager.ts`. `fitDeferred()` uses `this` only.
- `contextmenu.ts` imports `tabManager`; `tabmanager.ts` and `tab.ts` dynamically import `contextmenu.ts` (no cycle).

### Other frontend modules

| File | Role |
|---|---|
| `src/main.ts` | Init `TabManager`, PTY listener, settings button, calls all `init*()` |
| `src/profiles.ts` | SSH/WT profiles, config persistence, font defaults |
| `src/settings.ts` | Settings page (sidebar layout), `createSettingsContent()`, feedback/reset/apply |
| `src/window.ts` | Window controls, drag, maximize/restore, position saved on resize (NOT close) |
| `src/search.ts` | Search bar; per-tab `searchQuery` save/restore via `TerminalTab` |
| `src/profilemenu.ts` | New-tab dropdown (Local / SSH columns) |
| `src/contextmenu.ts` | Two menus: `showTabContextMenu` and `showTerminalContextMenu` |

### Backend (`src-tauri/src/lib.rs`)

Commands: `pty_spawn`, `pty_spawn_ssh`, `pty_write`, `pty_resize`, `pty_kill`, `window_minimize`, `window_toggle_maximize`, `window_close`, `window_start_drag`, `ssh_list_hosts`, `read_wt_settings`, `read_wt_fragments`, `find_vs_instances`, `read_config`, `write_config`, `save_text_file`.

Backend → Frontend: `pty-output` event `{ id, data: number[] }`.

## Critical gotchas

### Window close
- **Never** add `appWindow.onCloseRequested` with async handler — if it hangs, window won't close.
- Close button uses event delegation on `#tab-bar` checking `btn.id` via `switch`.

### Right-click behavior (split menus)
Two separate context menus, triggered differently:

| Trigger | Menu | Exported fn |
|---|---|---|
| Right-click on **tab bar** element | Tab operations (Change Color, Rename, Duplicate, Close, Close Right, Close Others) | `showTabContextMenu` |
| **Shift+right-click** on terminal area | Content operations (Copy, Paste, Clear, Find, Export Text) | `showTerminalContextMenu` |
| Right-click on terminal (no shift) | Copy if selected (`execCommand("copy")`), Paste if not (`clipboard.readText`) | Built into `TerminalTab` constructor |

- Terminal right-click uses **capture phase** (`addEventListener(…, true)`) so it fires before xterm.js internal handler.
- Copy uses `execCommand("copy")` + hidden textarea (NOT `navigator.clipboard.writeText`) to avoid browser clipboard permission prompt.
- Tab right-click does NOT require Shift — fires on regular right-click.

### Terminal rendering
- **Never** add `will-change: transform` or `transform: translateZ(0)` on `.terminal-instance .xterm` — forces GPU compositing layer, causes sub-pixel gaps between monospace glyphs.
- **Always** keep `outline: none !important` on `.terminal-instance .xterm textarea:focus` — Chrome draws dashed focus ring on xterm's hidden textarea.

### Tab switching & resize
- `TerminalTab.hide()` always sets `needsResize = true`. `show()` does NOT fit.
- `TabManager.switchTo()` handles `wasSettingsOpen`: if same tab was hidden by settings, re-shows it.
- Window resize: all tabs marked dirty; only active tab fitted immediately.

### Settings page
- Layout is **sidebar** (`flex-direction: row`). `.settings-sidebar` left (200px, `#252526`), `.settings-body` right.
- Settings tab permanent (created once in `_openSettings`, never removed). `data-tab-id="#settings"` excluded from badge counting.
- `toggleSettings()` opens only (no-op if open). Close via: tab close button, terminal tab click.
- Footer: `[feedback text] … … [▲ Reset] [Apply]`. Apply turns gray on save, re-enables on any input change. Reset dropdown: "Reset Changes" (reload from disk), "Reset All" (clear config file).

### Fit tolerance
`fit()` uses 10% char-height tolerance. `Math.max(2, proposed.cols)` min 2 columns.

### Search state
Per-tab: `TerminalTab.searchQuery` saved on `closeFind` and `input` event, restored on `openFind`.

### xterm.js v6 scrollbar
Custom `.xterm-scrollable-element > .scrollbar > .scra`. `.xterm-viewport` MUST keep `overflow-y: scroll`.

### Platform
- Windows shell: `cmd.exe`. Unix: `$SHELL` or `/bin/sh`.
- Vite binds `127.0.0.1` (not `::1`).
- Icon: `src/assets/tterm.svg`. Regenerate with `sharp` one-liner in `CLAUDE.md`.
