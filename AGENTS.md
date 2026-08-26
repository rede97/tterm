# Repository Guidelines

## Project Overview

TTerm is a Windows desktop terminal for CLI agents (Codex, Claude Code): local shells (ConPTY), SSH (system `ssh` or embedded russh client), and serial devices, with CJK/IME support and AI session sharing. Stack: Tauri 2 (Rust backend, undecorated WebView2 window) + TypeScript/lit-html frontend (Vite, xterm.js). Package/runtime: **Bun-first** (`bun run <script>`); Rust via cargo.

Current branch: `feat/ui-redesign-migration` — full chrome redesign (design tokens `--tt-*`, skins, command palette, quick-panel 1:1, Settings 1:1, close-window confirm) ahead of `main`. Design fact sources: `docs/*-preview.html` + `docs/ui/tokens.css`; parity tracked in `docs/ui/parity-gap.md` (CLOSED). `AGENT.md` (existing) holds deeper domain notes (IME, PTY, SSH, tray).

## Architecture & Data Flow

**Transport split (red line).** Terminal byte streams NEVER cross Tauri IPC. All sessions multiplex one loopback WS hub (`src-tauri/src/relay.rs`, started in `lib.rs` setup before any spawn): `ws://127.0.0.1:<port>/pty/<id>?token=<64-hex per-process token>` (constant-time compare). IPC `invoke()` is control-only (spawn/resize/kill/config). The same port serves plain HTTP for AI sharing (`share.rs` peeks the connection).

**Sessions** (all become Read/Write pairs in the relay, so dead-mode reconnect, re-attach, and sharing work uniformly):
- Local PTY — `pty.rs` (ConPTY; exit watchdog drops master, ConPTY gives no EOF)
- SSH — spawned binary (`pty_spawn_ssh`) or embedded russh (`sshclient/`: session/auth/prompter/forward/keys/install)
- Serial — `serial.rs` (+ `serial_win.rs` DCB patch to match PuTTY modem lines)
- Demo TTY — `demo.rs` (debug only)

**Dead-mode is in-band** (`deadmode.rs`): EOF keeps WS open, injects terminal reset + red notice, Enter respawns. Clean exit code 0 → `session-exited` → frontend auto-closes tab. Transport drops (1006) re-attach silently with backoff; relay buffers output while detached.

**Frontend boot** (`src/main.ts`): `configStore.load()` → WT/themes/serial profiles → first tab. `src/wiring.ts` is the composition root — feature modules declare `setXxxHandlers` and NEVER import TabManager (acyclicity invariant). Static ids live in `index.html` + `src/core/dom-ids.ts` (rename both together).

**Config** (`src/core/store.ts`): declarative SCHEMA, `set()` validates + 300ms debounced atomic write (tmp+rename; `config.rs` whitelists `[config, themes, serial-profiles, keybindings, ssh-history]`); `RUNTIME_KEYS` never persisted; keybindings in own `keybindings.json`; Temporary Connect MRU in `ssh-history.json` (never `~/.ssh/config`, never passwords). Rust does raw I/O only — parsing/validation/migration is always frontend. Debug builds use `<config>/dev/`.

**Settings** (`src/settings/`): pseudo-tab (not in `tabs` Map; suspend keeps DOM). Apply = all panels' `collectXxxSettings` → one `configStore.set`; SSH edits write `~/.ssh/config` in the same click. Revert = `configStore.load()` + refresh. Dirty via delegated `input/change` + bubbling `tterm-settings-changed` / `tterm-ssh-dirty` events.

**Resize/fit**: `terminal/fit.ts computeGrid` (pure, hysteresis) → `terminal.onResize` → `pty_resize` IPC (single path — never invoke manually). **IME**: `imefilter → imeanchor → imefreeze (textarea.style Proxy) + imebox mirror` — pure display, never focuses/injects.

## Key Directories

- `src/core/` — store, keymap, types, dom-ids, errorlog, traytabs, updater, devhooks (`window.__tterm`, DEV only)
- `src/terminal/` — tabmanager (sessions, drag reorder, close flow), tab.ts (xterm+WS attach+IME wiring), fit, quickpanel, contextmenu, profilemenu, closetab, paste, serialctl, tabactions, settingsshell
- `src/settings/` — settings shell + 6 panels (general/appearance/profile/ssh/serial/keyboard) + editors (theme/serial-profile/ssh-host/ssh-keys)
- `src/ui/` — lit.ts (single lit-html import + vocabulary), dom, select (custom listbox), confirm/modal, stepper, menukeys, fontpicker, forwardtable/forwarding, tabswitcher, palette, overlay-scroll, toast, window, tokens.css
- `src/util/` — imebox/imeanchor/imefreeze/imefilter, sizehint, hysteresis, themes, fontconfig, serialinput, osc, disconnect, xterm-internals (ONLY place private xterm APIs are touched)
- `src/config/` — wt-profiles, ssh-config, custom-themes, serial-profiles (frontend owns all parsing)
- `src-tauri/src/` — lib, relay, pty, serial(+_win), sshclient/, ssh, share, deadmode, state, window, tray, config, wt, newline, cmdparse, fonts, demo
- `tests/` (vitest), `e2e/` (wdio + tauri-driver), `docs/` (design system), `plugins/` (biome grit rules)

## Development Commands

| Task | Command |
|------|---------|
| Dev (vite :1420) | `bun run dev` |
| Dev app | `bun run tauri dev` |
| Typecheck+build | `bun run build` (= `tsc && vite build`) |
| Lint (biome+grit) | `bun run lint` / autofix `bun run lint:fix` |
| Unit tests | `bun run test` (vitest, happy-dom) |
| Rust tests | `bun run test:rust` |
| E2E (debug exe) | `bun run test:e2e`; per-spec `--spec e2e/specs/ime.e2e.js` |
| E2E (release) | `bun run test:e2e:release` (prereq dance documented in `e2e/wdio.release.conf.js`) |

Constraints: vite pinned `127.0.0.1:1420` strictPort (HMR 1421; never `localhost` — IPv6 `::1` breaks WebView2). ES2022 build target — do NOT lower (esbuild logical-assignment mis-lowering froze SSH tabs once). E2E needs `src-tauri/target/debug/tterm.exe` (`cargo build` first) and port 1420 free. CI (`.github/workflows/ci.yml`): lint → build → vitest → cargo fmt --check → cargo test; e2e NOT in CI. Release: `v*` tag is version source of truth (workflow rewrites tauri.conf.json/package.json/Cargo.toml).

## Code Conventions & Common Patterns

- **DI via handlers**: `interface XxxHandlers` + `let _handlers` + `setXxxHandlers(h)`, bound in `wiring.ts`. Feature modules never import TabManager. Dynamic `import()` in init functions keeps startup lazy.
- **lit-html** (`src/ui/lit.ts` is the only import point): no innerHTML rebuilds (focus/scroll/expansion must survive re-renders); `<select>` uses `data-current=` + `syncSelectValues(root)` after every render; never write `textContent` into lit-bound elements (ejects parts); text glued to tags (whitespace = real nodes, e2e asserts exact textContent); busy guards in handlers, NOT `?disabled`.
- **Settings panels**: `const panelStates = new WeakMap<HTMLElement, XxxPanelState>()` + `stateOf(panel)`; templates pure functions of store+state; `repeat(items, key, tpl)`; export `create/refresh/collect`.
- **Errors**: `.catch(logCatch("domain.action"))`, `swallow()` only for provably-ignorable, `showToast(msg, "error")` for user-facing. Bare `catch{}` banned (grit). Native `alert/confirm/prompt` banned (grit) — use `ui/confirm.ts`/`modal.ts`/`toast.ts` (every dismissal resolves false).
- **Async guards**: monotonic tokens (`socketGen`), re-entry sets (`_closing`), in-handler busy flags over disabled attributes.
- **Shared controls**: `ui/kit/` (`controls.css` + `select.ts` `.tt-select`, `lit.ts` `.tt-switch` / `.section`/`.row` / `.tt-btn*`, `stepper.ts`, `modal.ts`); menu portals to `<body>`; `ui/overlay-scroll.ts` (true overlay scrollbar — Chromium has none; webkit width = classic gutter).
- **Design tokens**: `--tt-*` in `src/ui/tokens.css` (skins `body[data-skin]`, `body.qp-glass`). `--term-bg` is JS-written per terminal scheme (2px seam) — NOT a `--tt-*` token. Tab chrome stays fixed dark. Settings is strictly 1:1 with `docs/settings-preview.html` (148px `--tt-btn-width`, row wells `.row`, visibility = LEFT checkbox `.check-row`, toggles only for single on/off).
- **Style**: Biome 2-space, lineWidth 100, organized imports, no `any`/non-null assertions (errors), no import cycles. `cargo fmt` after Rust edits.

**Non-obvious invariants** (breaking these breaks things):
1. `#tab-bar` height 32px; `#terminal-container` padding 2px + `min-height:0`; `.xterm-screen padding-right:6px` — fit.ts reads all three. Never zero container padding under `:has(> .settings-page)`.
2. `.ime-box` CSS `transition: opacity 0ms` must equal `FADE_MS` in `imebox.ts`; imefreeze clamps textarea to a full cell (1px kills TSF); right edge clamp SAFE_RIGHT=220; proxy `set` never forwards `receiver`.
3. `WsHub::start()` before any session spawn; `WsHub.emit_fn` is `Box<dyn Fn>` (plain `Mutex<Option<AppHandle>>` breaks test binary load).
4. `closeTab` re-entry guarded by `_closing`; pending-ssh tabs skip `pty_kill`.
5. Window min 800×600 must match `tauri.conf.json`; never enforce min-size on every Resized (aborts WS_MAXIMIZE).
6. `window.__tterm.tabs` must stay a getter (Map reassigned on drag reorder).
7. SSH auth prompts block the backend — answer exactly once via `ssh_auth_response`/`ssh_hostkey_response` (cancel also responds).
8. Serial profile switch ≠ link params: live profile switch must not touch baud/flow.

## Important Files

- Entry: `src/main.ts`, `src/wiring.ts`, `index.html`, `src-tauri/src/lib.rs`
- Config: `src/core/store.ts`, `src/core/keymap.ts`, `src/core/dom-ids.ts`, `vite.config.ts`, `tsconfig.json`, `biome.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`
- Key modules: `src/terminal/tabmanager.ts`, `src/terminal/tab.ts`, `src/settings/index.ts`, `src/ui/lit.ts`, `src/ui/select.ts`, `src/styles.css` (all layout invariants, commented), `src-tauri/src/relay.rs`, `src-tauri/src/share.rs`
- Docs: `AGENT.md` (domain deep-dives), `docs/ui/parity-gap.md`, `docs/backlog.md` (open items: real-IME acceptance), `CHANGELOG.md`

## Runtime/Tooling Preferences

- **Bun** for all npm scripts and installs (`bun.lock`; `package-lock.json` is legacy). Rust stable via cargo; `cargo fmt`/`cargo test --manifest-path src-tauri/Cargo.toml`.
- Biome (2.5.8) + grit plugins = lint gate; vitest 4 + happy-dom = unit layer; WebdriverIO 9 + tauri-driver + pinned `e2e/drivers/msedgedriver.exe` = e2e layer.
- lit-html, xterm (+webgl/search/fit addons), SortableJS, lucide, @fontsource mono fonts (no embedded Nerd Fonts — system/registry fonts); russh, portable-pty, serialport, tokio-tungstenite (rustls) on the Rust side.

## Testing & QA

- **Vitest** (`tests/*.test.ts`, happy-dom): mock IPC by hoisting `invokeMock` via `vi.hoisted()` + `vi.mock("@tauri-apps/api/core")` BEFORE importing src (module singletons). Reset `document.body.innerHTML` per test. Stub layout metrics via `Object.defineProperty` (happy-dom computes none). Fake tabs: cast `as unknown as TerminalTab`. Settings tests: `openPanel()` + DOM contracts (e.g. `dataset.themeName`, `aria-checked`, `data-current` on custom selects; portaled menus queried at `body > .tt-select-menu`).
- **E2E** (`e2e/specs/*.e2e.js`): debug exe + vite dev + tauri-driver; introspect via `window.__tterm` (DEV hook). Always wait for app init first (`__tterm` exists + `tabs.size >= 1` — cold vite transform races). Serial fixture: MOCK-LOOP/MOCK-NL ports (debug). `qpPick` helper for custom selects. Self-clean state (see theme.e2e.js `E2E Custom`).
- **Rust**: colocated `cargo test` (132 tests incl. sshclient).
- **Manual**: real-IME acceptance checklist in `docs/backlog.md` — synthetic events/e2e cannot replace real TSF input; required before closing IME items.
- Expectations: behavior contracts over plumbing (menu contents, DOM state machines, IPC payloads). New observable contracts need a unit test; real-app regressions need an e2e assertion (e.g. select menu visibility: computed `display` + non-zero rect, not inline style strings).
