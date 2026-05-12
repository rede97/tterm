# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Runtime

Prefer **Bun** over npm/node for all package scripts (faster installs, faster dev server). The project still supports npm as fallback, but `bun run` is the default.

## Project

A multi-tab desktop terminal emulator (TTerm) built with Tauri v2. The frontend is vanilla TypeScript + Vite using xterm.js to render terminals. The Rust backend spawns native shells via PTY (pseudo-terminal) and pipes I/O between each shell and its corresponding tab.

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
- `src/main.ts` — `Tab` interface (with `needsResize` flag), `tabs: Map<string, Tab>`, terminal factory, tab bar UI, context menu, window controls, resize handling
- `src/profiles.ts` — extracted profile/config module: types (`SshHost`, `LocalProfile`, `VsInstallation`), state (`sshHosts`, `localProfiles`, `vsInstalls`, `defaultLocalProfile`), WT profile parsing (settings.json + fragment extensions), config persistence
- `src/styles.css` — VS Code-style tab bar (#252526), dark terminal theme (#1e1e1e), unified scrollbar styling

### Backend (`src-tauri/`)

- `src-tauri/src/main.rs` — entry point, calls `tterm_lib::run()`
- `src-tauri/src/lib.rs` — Tauri builder setup, PTY session management, SSH config parsing, VS instance discovery, WT fragment loading, config persistence
- `src-tauri/build.rs` — standard `tauri_build::build()`
- `src-tauri/tauri.conf.json` — product name "TTerm", window config (no decorations), NSIS installer, icon paths

### PTY session model (`lib.rs`)

- `AppState` holds `HashMap<String, PtySession>` + `next_id` counter + `initial_cwd: Option<PathBuf>` (set via `--working-directory` CLI arg)
- `PtySession` stores the PTY `master` (for resize) and `writer` (for write)
- Each tab spawns a dedicated shell process and background read thread
- `apply_initial_cwd()` sets the working directory on CommandBuilder before spawn

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
| `read_wt_fragments` | — | return raw fragment extension JSONs from WT fragment dirs |
| `find_vs_instances` | — | discover VS installations via vswhere/known paths |
| `read_config` | — | read app config from `{app_config_dir}/config.json` |
| `write_config` | `content` | write JSON string to app config file |
| `ssh_list_hosts` | — | parse `~/.ssh/config`, return host list |
| `save_text_file` | `content` | save text to file via native save dialog |

Backend → Frontend: Tauri events (`pty-output`)

| event | payload | purpose |
|---|---|---|
| `pty-output` | `{ id: string, data: number[] }` | shell output routed to correct tab |

User keystrokes go `xterm.js` → `pty_write` invoke → Rust writes to PTY stdin.
Shell output goes PTY stdout → Rust reads → `pty-output` event → `term.write()`.

## Key dependencies

- Frontend: `@xterm/xterm`, `@xterm/addon-fit`, `@xterm/addon-search`, `@tauri-apps/api`
- Backend: `tauri` v2, `portable-pty` (cross-platform PTY), `serde`, `serde_json`
- Icons: `lucide` (MIT-licensed SVG icon library, stroke-based, consistent 2px weight)
- Icon generation: `sharp` (devDependency, used to rasterize `src/assets/tterm.svg` into platform icon formats)

## Profile loading flow

1. **SSH** — Rust reads `~/.ssh/config`, parses Host entries with wildcard inheritance
2. **Windows Terminal profiles** — Rust reads WT's `settings.json` (raw content) + fragment extension files from:
   - `%LOCALAPPDATA%\Packages\Microsoft.WindowsTerminal_*\LocalState\Fragments\<ext>\*.json`
   - `%LOCALAPPDATA%\Microsoft\Windows Terminal\Fragments\<ext>\*.json`
   - `%ProgramData%\Microsoft\Windows Terminal\Fragments\<ext>\*.json`
   
   Frontend parses both sources. Profiles with `commandline` are used directly. For profiles without `commandline`:
   - `source: "Windows.Terminal.VisualStudio"` → resolved via vswhere-discovered VS instances
   - `source: "Windows.Terminal.Wsl"` → `wsl.exe -d "<name>"`
   - `source` containing "Azure" → **skipped entirely**
   - Unrecognized sources with no `commandline` → dropped (fragments should provide the real commandline)

3. **Default profile** — Config persisted in `{app_config_dir}/config.json`. Priority: user-set default → first profile → cmd.exe fallback

## Profile dropdown menu

Two-column layout (Local | SSH) with a vertical divider. Centered on the new-tab menu button, clamped to viewport edges on overflow. Each profile item has a Lucide icon, label, optional detail text, and click-to-launch.

## Lazy resize

`Tab.needsResize` flag avoids resize-all-lag when switching tabs. On window resize: all tabs marked dirty, only active tab fitted + PTY-resized (flag cleared). On tab switch: if the entered tab has `needsResize`, `applyFit()` + `pty_resize` fires, flag cleared. Only 2 tabs ever resize per switch — the one left and the one entered.

## Fit tolerance (resize flicker prevention)

`applyFit()` uses `proposeDimensions()` (read-only) to get suggested dimensions, applies 10% char-height tolerance before shrinking rows/cols. This prevents grid resize oscillation from sub-pixel overflow.

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

## Icon generation

App icon source is `src/assets/tterm.svg`. To regenerate platform icons after editing the SVG:

```sh
node -e "
const sharp = require('sharp');
const fs = require('fs');
const svg = fs.readFileSync('src/assets/tterm.svg');
const dir = 'src-tauri/icons';
const targets = [[32,'32x32.png'],[128,'128x128.png'],[256,'128x128@2x.png'],[512,'icon.png'],[30,'Square30x30Logo.png'],[44,'Square44x44Logo.png'],[71,'Square71x71Logo.png'],[89,'Square89x89Logo.png'],[107,'Square107x107Logo.png'],[142,'Square142x142Logo.png'],[150,'Square150x150Logo.png'],[284,'Square284x284Logo.png'],[310,'Square310x310Logo.png'],[100,'StoreLogo.png']];
(async()=>{for(const[s,n]of targets)await sharp(svg).resize(s,s).png().toFile(dir+'/'+n);const icoS=[16,24,32,48,64,128,256],p=await Promise.all(icoS.map(s=>sharp(svg).resize(s,s).png().toBuffer()));let h=Buffer.alloc(6),o=6+16*icoS.length;h.writeUInt16LE(0,0);h.writeUInt16LE(1,2);h.writeUInt16LE(icoS.length,4);let bufs=[h];for(let i=0;i<icoS.length;i++){let e=Buffer.alloc(16);e.writeUInt8(icoS[i]>=256?0:icoS[i],0);e.writeUInt8(icoS[i]>=256?0:icoS[i],1);e.writeUInt16LE(1,4);e.writeUInt16LE(32,6);e.writeUInt32LE(p[i].length,8);e.writeUInt32LE(o,12);o+=p[i].length;bufs.push(e)}for(const x of p)bufs.push(x);fs.writeFileSync(dir+'/icon.ico',Buffer.concat(bufs));fs.copyFileSync(dir+'/icon.png',dir+'/icon.icns')})();
```

## Platform notes

On Windows, the default shell is `cmd.exe`. On Unix, it's the user's `$SHELL` (fallback `/bin/sh`). `portable-pty` abstracts PTY resize and process handling across platforms. The Vite dev server binds `127.0.0.1` explicitly (not `::1`) because IPv6 loopback has connectivity issues on Windows. `AppState.initial_cwd` is populated from the `--working-directory` CLI argument (passed by Windows Terminal integration). VS instances are discovered via `vswhere.exe` with a fallback to scanning common `Program Files` paths.
