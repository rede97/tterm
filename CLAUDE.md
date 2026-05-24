# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Runtime

Use **Bun** (`bun run <script>`). Fall back to `npm run` if unavailable.

```sh
bun run build        # tsc typecheck + vite build (always do this before committing)
bun run tauri dev    # full Tauri app in dev mode
bun run tauri build  # production binary
```

No tests or linters are configured.

**Always run `bun run build` before committing.** Before creating a release tag, ensure the build output has zero warnings (including vite `[plugin vite:reporter]` warnings).

## Project

A multi-tab desktop terminal emulator (TTerm) built with Tauri v2. The frontend is vanilla TypeScript + Vite using xterm.js to render terminals. The Rust backend spawns native shells via PTY (pseudo-terminal) and pipes I/O between each shell and its corresponding tab.

## Architecture

### Tab system (`src/tab.ts`, `src/tabmanager.ts`)

- **`src/tab.ts`** — `TerminalTab` class. Each tab owns: terminal, xterm, DOM, color, index (`index`), search state (`searchQuery`), context menu handler. Key methods:
  - `show()` — `display:""`, add `active`, `terminal.focus()`
  - `hide()` — `display:"none"`, remove `active`, set `needsResize = true`
  - `fit()` — hysteresis-based calculation, returns `{ cols, rows }` and resizes terminal
  - `fitDeferred()` — double-rAF fit; aborts if hidden. Calls `pty_resize` on complete.
  - `setColor()`, `rename()`, `destroy()` — self-explanatory

- **`src/tabmanager.ts`** — `TabManager` class (singleton: `tabManager`). Owns tab Map, active tab, settings, resize, new-tab button.
  - `switchTo(id)` — closes settings first if open; if same tab was hidden by settings, re-shows it
  - `toggleSettings()` — opens only (no-op if already open); close via tab close button or terminal tab click
  - `refreshBadges()` — queries `.tab[data-tab-id^="tab-"]` (skips `#settings`); sets `tab.index` per tab
  - `closeTab(id)` — kills PTY, destroys terminal, switches to neighbor (skipping settings tab), refreshes badges

- **`src/state.ts`** — `appState` as alias for `tabManager`. Do NOT add new state here.
- **`src/terminal.ts`** — ORPHANED (no imports). Old `createTerminal`/`applyFit`/`showSizeHint`; kept for reference.
- **`src/tabs.ts`** — DELETED. Migrated to `tab.ts` + `tabmanager.ts`.

### Circular dependencies: DO NOT introduce

- `tab.ts` must NEVER import `tabmanager.ts`. `fitDeferred()` uses `this` only.
- `contextmenu.ts` imports `tabManager`; `tabmanager.ts` and `tab.ts` dynamically import `contextmenu.ts` (no cycle).

### Other frontend modules

| File | Role |
|---|---|
| `src/main.ts` | Init `TabManager`, PTY listener, settings button, welcome screen, calls all `init*()` |
| `src/profiles.ts` | SSH/WT profiles, config persistence, font defaults |
| `src/settings.ts` | Settings page (sidebar layout), `createSettingsContent()`, feedback/reset/apply |
| `src/window.ts` | Window controls (min/max/close), drag handling, maximize/restore icon toggle |
| `src/search.ts` | Search bar; per-tab `searchQuery` save/restore via `TerminalTab` |
| `src/profilemenu.ts` | New-tab dropdown (Local / SSH columns) |
| `src/fontconfig.ts` | Font definitions, default stack, system font enumeration, buildFontFamily/parseFontFamily |
| `src/fontpicker.ts` | Font picker modal; dynamically imported by settings.ts, never statically imported |
| `src/settings-events.ts` | Shared `setOnSettingsChanged` callback; used by both main.ts and settings.ts (lazy-loaded) |
| `src/contextmenu.ts` | Two menus: `showTabContextMenu` (tab bar right-click) and `showTerminalContextMenu` (shift+right-click on terminal) |
| `src/types.ts` | `PtyOutputPayload`, `TabType`, `Tab` interface |

### Backend (`src-tauri/`)

- `src-tauri/src/lib.rs` — Tauri builder, PTY management, SSH config parsing, WT profile/fragment loading, config I/O, plugin registration
- `src-tauri/src/main.rs` — entry point, calls `tterm_lib::run()`
- `src-tauri/capabilities/default.json` — permissions (core, window, opener, window-state)
- Plugins: `tauri-plugin-window-state` (auto save/restore window size, position, maximize), `tauri-plugin-dialog`, `tauri-plugin-opener`

### PTY session model

- `AppState` holds `HashMap<String, PtySession>` + `next_id` counter + `initial_cwd: Option<PathBuf>` (set via `--working-directory` CLI arg)
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
| `read_wt_fragments` | — | return raw fragment extension JSONs from WT fragment dirs |
| `find_vs_instances` | — | discover VS installations via vswhere/known paths |
| `read_config` | — | read app config from `{app_config_dir}/config.json` |
| `write_config` | `content` | write JSON string to app config file |
| `ssh_list_hosts` | — | parse `~/.ssh/config`, return host list |
| `ssh_read_config_raw` | — | return raw `~/.ssh/config` content |
| `ssh_save_config` | `content` | write raw SSH config string to `~/.ssh/config` |
| `ssh_clear_known_hosts` | `hostname` | run `ssh-keygen -R <hostname>` |
| `open_ssh_config` | — | open `~/.ssh/config` in system editor |
| `open_config_dir` | — | open `{app_config_dir}` in file explorer |
| `delete_config` | — | delete `config.json` (used by Reset All) |
| `save_text_file` | `content` | save text to file via native save dialog |
| `list_system_fonts` | — | enumerate installed fonts from Windows registry |
| `serial_list_ports` | — | enumerate serial ports |

Backend → Frontend: `pty-output` event `{ id: string, data: number[] }`.

## Profile loading flow

1. **SSH** — Rust reads `~/.ssh/config`, parses Host entries with wildcard inheritance
2. **Windows Terminal profiles** — Rust reads WT's `settings.json` (raw content) + fragment extension files from:
   - `%LOCALAPPDATA%\Packages\Microsoft.WindowsTerminal_*\LocalState\Fragments\<ext>\*.json`
   - `%LOCALAPPDATA%\Microsoft\Windows Terminal\Fragments\<ext>\*.json`
   - `%ProgramData%\Microsoft\Windows Terminal\Fragments\<ext>\*.json`

   Frontend parses both sources. Profiles with `commandline` are used directly. For profiles without `commandline`:
   - `source: "Windows.Terminal.VisualStudio"` → resolved via vswhere-discovered VS instances
   - `source: "Windows.Terminal.Wsl"` → `wsl.exe -d "<name>"`
   - `source` containing "Azure" → `wt.exe -p "<name>"` (resolved via WT itself)
   - Unrecognized sources with no `commandline` → dropped (fragments should provide the real commandline)

3. **Default profile** — Config persisted in `{app_config_dir}/config.json`. Priority: user-set default → first profile → cmd.exe fallback

## Profile dropdown menu

Two-column layout (Local | SSH) with a vertical divider. Centered on the new-tab menu button, clamped to viewport edges on overflow. Each profile item has a Lucide icon, label, optional detail text, and click-to-launch. Hidden profiles (toggled off in Settings > Profile) are excluded from this menu.

## Right-click behavior (split menus)

| Trigger | Action |
|---|---|
| Right-click on **tab** | Tab operations (New Tab, Open in New Window, Change Color, Rename, Duplicate, Close, Close Right, Close Others) |
| **Shift+right-click** on terminal | Content operations (Copy, Copy as HTML, Paste, Clear, Find, Export Text, New Tab, Open in New Window) |
| Right-click on terminal (no shift) | Copy if selected (`execCommand("copy")`), Paste if not (`clipboard.readText`) |

- Terminal right-click uses **capture phase** (`addEventListener(…, true)`) to fire before xterm.js internal handler.
- Copy uses `execCommand("copy")` + hidden textarea (NOT `navigator.clipboard.writeText`) to avoid browser clipboard permission prompt.
- Global `document.addEventListener("contextmenu", e => e.preventDefault())` blocks all browser native context menus.

## Font system

### Font stack model

- `fontconfig.ts` holds the current `fontStack: string[]` — an ordered list of font families (no CSS quoting).
- `buildFontFamily(fonts)` converts to CSS `font-family` value: quotes font names with spaces, appends `monospace` as implicit final fallback.
- `parseFontFamily(css)` reverses this: strips quotes, removes `monospace`.
- **`monospace` is never stored in config or displayed in the picker** — it's always appended by `buildFontFamily()` at the CSS boundary.

### Default font stack

`defaultFontStack()` → `["JetBrains Mono", "Noto Sans SC", "Noto Sans JP", "Noto Sans KR", "Consolas"]`

Noto Sans fonts are per-script variants (SC = Simplified Chinese, JP = Japanese, KR = Korean) — NOT a single "Noto Sans CJK" family. These provide CJK character fallback for the preview samples.

### Font picker

- `showFontPickerDialog(onApply)` in `fontpicker.ts` — dynamically imported by settings.ts when user clicks "Configure".
- Two source columns: Built-in (BUILTIN_FONTS + NERDFONT_BUILTIN) and System (enumerated from registry).
- Click a font name → preview that single font in the xterm preview area. Click again → preview full stack.
- "+" button adds/removes font from the used list.
- ▲/▼ buttons reorder priority (NOT HTML5 drag — doesn't work reliably in WebView).
- Preview terminal uses `configFontSize` (not hardcoded), `scrollback: 5000`, custom scrollbar matching main terminal.

### Initial value consistency

`configFontFamily` (profiles.ts module-level init) and `getDefaultConfig()` MUST produce the same value. Always use `buildFontFamily(defaultFontStack())` for both to avoid drift.

## Terminal rendering gotchas

- **Never** add `will-change: transform` or `transform: translateZ(0)` on `.terminal-instance .xterm` — forces GPU compositing layer, causes sub-pixel gaps between monospace glyphs.
- **Always** keep `outline: none !important` on `.terminal-instance .xterm textarea:focus` — Chrome draws dashed focus ring on xterm's hidden textarea.
- **Web font loading race**: xterm.js measures character cell dimensions during `terminal.open()`. If @fontsource web fonts haven't loaded yet, xterm caches wrong glyph metrics (usually too wide). Fix: `_ensureFontsReady()` in tabmanager.ts waits for `document.fonts.ready` then toggles fontFamily to force re-measure, all before `switchTo()` shows the tab. Without this, the first tab renders with wide character spacing until the next window resize.

## Tab switching & resize

- `TerminalTab.hide()` always sets `needsResize = true`. `show()` does NOT fit.
- `TabManager.switchTo()` handles `wasSettingsOpen`: if same tab was hidden by settings, re-shows it.
- Window resize: all tabs marked dirty; only active tab fitted immediately (debounced 10ms).

## Fit & hysteresis

`TerminalTab.fit()` uses a hysteresis function (`src/tab.ts:18`) that computes an acceptable integer range from `floatVal` and clamps current to it:

```
hysteresis(floatVal, current, th_low, th_high, min=2)
```

- **Cols**: `th_low=0.8, th_high=0.9` — grows only when fractional part > 90% of a char
- **Rows**: `th_low=0.98, th_high=1.0` — never grows past floor; shrinks immediately
- Pure function: no reference to `floatVal - current` gap. Avoids oscillation from intermediate resize animation frames.
- `min=2` floor clamp prevents degenerate grid.

`fitDeferred()` uses double-rAF; aborts if terminal is hidden (`display: none`).

## Settings page

- Settings module (`src/settings.ts`, ~620 lines) is **lazy-loaded** via `import("./settings")` when the user first clicks the Settings button. The `TabManager` factory accepts `() => Promise<HTMLElement>` and `_openSettings()` is async.
- Callback pattern: `setOnSettingsChanged` lives in `src/settings-events.ts` (tiny shared module, eagerly loaded). Both main.ts and settings.ts import from it — avoids circular dependencies while keeping the callback channel light.
- Layout: **sidebar** (`flex-direction: row`). `.settings-sidebar` left (200px, `#252526`), `.settings-body` right.
- Settings tab created in `_openSettings()`, removed from DOM on close. `data-tab-id="#settings"` excluded from badge counting.
- `toggleSettings()` opens only (no-op if open). Close via: tab close button, or switching to any terminal tab.
- Four panels: General (renderer, scrollback, paste options, terminal bell, tab width, data), Appearance (font family/size), Profile (default profile, imported WT profile visibility toggles), SSH (host visibility, expand, save, clear known hosts).
- Footer: `[feedback text] … … [Revert] [Apply]`. Apply saves config, turns gray on save, re-enables on any input change. Revert reloads config from disk.
- Profile panel shows ALL imported profiles including hidden ones (unchecked). Hidden profiles are filtered from the new-tab dropdown only.
- SSH config parsing/generation is entirely frontend-owned (profiles.ts `parseSshConfig`/`generateSshConfig`). Rust only handles raw file I/O. Keys preserve original SSH config casing (e.g. `ForwardAgent` not `forwardagent`).

## Custom window decorations

The app runs without native title bar (`decorations: false` in tauri.conf.json). The tab bar (`#tab-bar`) serves as the title bar with:
- Tabs on the left, new-tab button with dropdown menu adjacent
- `#drag-spacer` with `data-tauri-drag-region` fills center
- `#window-controls` (minimize/maximize/close) on the right with Lucide SVG icons

Window dragging: `mousedown` on tab bar registers `mousemove` listener. Only if the mouse actually moves does it call `window_start_drag`. On `mouseup` without movement the listeners clean up — this defers drag so `dblclick` on the tab bar can still toggle maximize.

Maximize/restore icon toggle: `#btn-maximize` holds two Lucide icons (`.ico-max` Square, `.ico-restore` Copy). The `updateMaximizeIcon()` function checks `appWindow.isMaximized()` and toggles the `.restore` CSS class, which swaps visibility via `display: none/block`.

Window state save/restore is handled entirely by `tauri-plugin-window-state`. Do NOT write custom save/restore code.

## xterm.js scrollbar

Custom DOM scrollbar (`.xterm-scrollable-element > .scrollbar > .scra`). 4px wide, `1px` from window right edge (via `#terminal-container` padding). Idle opacity 0.08, hover expands to 10px width with 0.6 opacity. `.xterm-viewport` MUST keep `overflow-y: scroll`. xterm grid bottom-aligned (`align-content: end`).

## Search state

Per-tab: `TerminalTab.searchQuery` saved on close and input events, restored on open.

## Key dependencies

- Frontend: `@xterm/xterm`, `@xterm/addon-fit`, `@xterm/addon-search`, `@xterm/addon-webgl`, `@tauri-apps/api`
- Backend: `tauri` v2, `portable-pty` (cross-platform PTY), `serde`, `serde_json`
- Icons: `lucide` (MIT-licensed SVG icon library, stroke-based, consistent 2px weight)
- Icon generation: `sharp` (devDependency, rasterize `src/assets/tterm.svg` into platform icon formats)

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

On Windows, the default shell is `cmd.exe`. On Unix, it's the user's `$SHELL` (fallback `/bin/sh`). Vite dev server binds `127.0.0.1` explicitly (not `::1`) because IPv6 loopback has connectivity issues on Windows. `AppState.initial_cwd` is populated from the `--working-directory` CLI argument (passed by Windows Terminal integration). VS instances are discovered via `vswhere.exe` with a fallback to scanning common `Program Files` paths.

## Shell tools: Bash vs PowerShell

This is **Windows**, so both shells are available — but they are NOT interchangeable. **Match syntax to the tool you call:**

| Tool | Shell | Syntax |
|---|---|---|
| `Bash` | bash (git-bash) | POSIX: `tail -n`, `grep`, `sed`, `cat`, `&&`, `$VAR`, `2>/dev/null` |
| `PowerShell` | powershell.exe | PS: `Get-Content`, `Select-Object`, `Get-ChildItem`, `;`, `$env:VAR`, `2>$null` |

**Never** use PowerShell cmdlets (`Get-Content`, `Select-Object`, `Select-String`) inside a `Bash` tool call — they will fail with "command not found". Similarly, never use bash syntax (`&&`, `tail`, `grep`) inside a `PowerShell` tool call.

If in doubt, prefer the dedicated tools (Read, Write, Edit, Grep, Glob) over shell commands.

## File editing

Use **PowerShell** (`Set-Content` / `Get-Content`) for file edits. The Edit tool frequently fails to match strings in this repo because Read tool output may not byte-match the actual file content (tab/space rendering, line ending normalization). PowerShell text replacement is reliable. Only use the Edit tool for trivial single-line changes.

## Git commits

Never use PowerShell here-strings (`@'...'@`) for commit messages — they inject a leading `@` and newline. Use a plain double-quoted message:

```sh
git commit -m "type: short description

- bullet point
- bullet point

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

## Release process

Before creating a release tag, ensure the build output has zero warnings (including vite `[plugin vite:reporter]` warnings).

**Version bump** — update the version field in all three files:
- `src-tauri/tauri.conf.json` — `"version": "X.Y.Z"`
- `src-tauri/Cargo.toml` — `version = "X.Y.Z"`
- `package.json` — `"version": "X.Y.Z"`

**Tag and release** — create an annotated tag with release notes. The release workflow extracts the tag body as the GitHub Release description:

```sh
git tag -a vX.Y.Z -m "vX.Y.Z

New Features

- feature one
- feature two

Fixes

- fix one

Improvements

- improvement one"
git push origin main
git push origin vX.Y.Z
```

The release workflow (`.github/workflows/release.yml`) triggers on `v*` tag push, builds the NSIS/MSI installers via Tauri, and creates a GitHub Release with the tag annotation as the body. Key detail: `actions/checkout` must use `fetch-depth: 0` to fetch the annotated tag object.
