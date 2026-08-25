# AGENT.md

Guidance for AI coding agents (pi, Claude Code, Cursor, etc.) working in this repository.

## Runtime

Use **Bun** (`bun run <script>`). Fall back to `npm run` if unavailable.

```sh
bun run build        # tsc typecheck + vite build (always do this before committing)
bun run lint         # Biome check — MUST pass with zero errors before committing
bun run lint:fix     # Biome safe autofixes + formatting
bun run tauri dev    # full Tauri app in dev mode
bun run tauri build  # production binary
```

Tests: `bun run test` (Vitest unit + happy-dom DOM tests in `tests/`), `bun run test:rust` (Rust unit tests, colocated in each `src-tauri/src/*.rs` module), `bun run test:e2e` (tauri-driver + WebdriverIO, see `docs/testing.md`). Lint/format: **Biome** (`biome.json`; `bunx biome check .`).

**Always run `bun run lint` and `bun run build` before committing.** Before creating a release tag, ensure the build output has zero warnings (including vite `[plugin vite:reporter]` warnings). **Always run `cargo fmt --manifest-path src-tauri/Cargo.toml` after editing Rust code** — CI gates on `cargo fmt --check`.

## Project

A multi-tab desktop terminal emulator (TTerm) built with Tauri v2. The frontend is vanilla TypeScript + Vite using xterm.js to render terminals. The Rust backend spawns native shells via PTY (pseudo-terminal) and bridges I/O over a local WebSocket loopback connection.

Headline differentiators: serial-port sessions done right, in-band disconnect/reconnect, and **CJK/IME input that works in cursor-hiding agent TUIs** (pi, Claude Code) via a floating composition mirror.

## Repo layout

```
src/
  main.ts               app entry: init TabManager, WS bridge, settings button, welcome backdrop
  terminal/
    tab.ts              TerminalTab class (one per tab: terminal, xterm, DOM, IME wiring)
    title.ts            TitleModel — tab title state machine (label / lock / OSC title)
    fit.ts              computeGrid — pure grid-fit calc (hysteresis + cell metrics)
    xtermfactory.ts     createXterm — Terminal construction + addon assembly
    tabmanager.ts       TabManager singleton (tab Map, active tab, settings tab, sortable)
    batchattach.ts      BatchAttachAddon — coalesces WS frames before terminal.write (see below)
    contextmenu.ts      tab-bar menu + shift-right-click terminal menu
    search.ts           search bar (per-tab query save/restore)
    profilemenu.ts      new-tab dropdown (Local / SSH / Serial columns)
    dirmenu.ts          "+" button folder picker + recent-folders menu (Shift+click / right-click)
    fontpicker.ts       font picker modal (dynamically imported by settings)
  core/
    store.ts            configStore — reactive config, single source of truth (schema + defaults);
                        per-topic JSON files: config.json + keybindings.json (keybindings route)
    keymap.ts           keyboard shortcuts: command registry, combo parsing, global dispatcher
    types.ts            shared TS types (TabType, PtyOutputPayload, ...)
    common.ts           shared constants/helpers
    errorlog.ts         logCatch / logError
  config/
    ssh-config.ts       ~/.ssh/config parse + generate (frontend-owned; Host * and pre-Host globals round-trip)
    wt-profiles.ts      Windows Terminal settings.json + fragment import
  settings/
    index.ts            settings shell (sidebar nav, footer Apply/Revert, panel routing)
    general|appearance|profile|ssh|serial|shortcuts.ts   the six panels
    sshhosteditor.ts    host Add/Edit modal; sshkeys.ts  key generate/install modals
  ui/
    window.ts           window controls, drag handling, maximize icon toggle, zen mode (F11)
    tabswitcher.ts      Ctrl+P quick-open + Ctrl+Tab MRU switcher overlay
    toast.ts            showToast — all user-facing errors
  util/
    imebox.ts           floating IME composition mirror + enable modes + debug flags
    imefilter.ts        CursorPositionFilter (stable-run cursor estimate for IME anchoring)
    imeanchor.ts        imeAnchorCell / cursorPixelPos (fake-cursor inverse-cell scan)
    imefreeze.ts        patchImeFreeze — textarea style Proxy (IME candidate window freeze)
    hysteresis.ts       fit hysteresis (see below)
    disconnect.ts       re-attach backoff helpers
    fontconfig.ts       font stack model, system font enumeration glue
    themes.ts           built-in theme gallery + WT theme import
    osc.ts              OSC 9;4 progress parsing
    serialinput.ts      serial input modes (normal/echo/line)
    sizehint.ts         cols×rows overlay during resize
src-tauri/src/
  lib.rs                crate root (mod wiring + run())
  state.rs              AppState / session tables
  relay.rs              unified WS relay hub shared by PTY/serial/demo
  pty.rs                PTY spawn/resize/kill
  sshclient/            embedded SSH client (russh): auth via frontend dialogs,
                        known_hosts TOFU, dynamic port forwarding, key
                        generation + ssh-copy-id install (see docs/ssh-client.md).
                        Split: prompter/hostkey/session/forward/keys/install
  deadmode.rs           in-band "session ended, Enter to reconnect" protocol
  serial.rs             serial sessions (+ live baud via SerialCtl)
  share.rs              AI session sharing: HTTP API on the hub (prompt doc, screen
                        snapshots w/ rate limit + long-poll, input POST), share tokens
  demo.rs               demo/anime TTY (debug builds only)
  ssh.rs wt.rs config.rs fonts.rs window.rs cmdparse.rs newline.rs
```

### Hard rules

- `terminal/tab.ts` must NEVER import `terminal/tabmanager.ts` (circular dependency). `fitDeferred()` uses `this` only. `contextmenu.ts` is dynamically imported to avoid cycles.
- All user-facing errors go through `showToast(message, "error")` (`src/ui/toast.ts`). Settings panels keep their inline feedback elements.
- Window state save/restore is handled entirely by `tauri-plugin-window-state`. Do NOT write custom save/restore code.

### Frontend discipline (TypeScript & DOM)

Style rules every agent must follow without being told twice. **Biome
enforces the mechanical ones** (`bun run lint`); the rest are review-duty
until the custom-rule rollout (`docs/frontend-governance.md` P1).

**Lint principles:**
- Zero lint ERRORS before every commit — CI's `check` job gates on it.
- Fix, don't suppress. An inline `biome-ignore` comment needs a one-line
  reason; blanket rule-off in `biome.json` is a governance decision, not a
  convenience.
- Warnings are the ratchet: `noNonNullAssertion` / `noExplicitAny` /
  `noDescendingSpecificity` are warn-level for legacy code — do NOT add
  new ones. New violations in your diff get fixed, not waved through.
- After `lint:fix` (esp. `--unsafe`), re-run the tests: unsafe fixes can
  change semantics (`x!` → `x?.` swallowed a real bug once — caught by
  tsc, not the test suite).

- **Errors**: no silent swallows. Promise tails end in `.catch(logCatch("area.action"))`, catch blocks use `logError`, and `swallow()` (`core/errorlog.ts`) only when the error is truly irrelevant (say why in a comment). Bare `.catch(() => {})` is banned. When the caught value is unused, write bare `catch { }` — no `catch (_)`.
- **Types**: `strict` is on. No `as any` — narrow with `in`/`typeof` guards at boundaries; type-only imports go top-level as `import type` (never inline `import("x").T` in annotations); no casting an object inline just to read one property.
- **Style**: no one-line wrapper functions — inline the expression unless the name is a stable domain concept used 3+ times. Static lookup tables are `Record<string, …>`; runtime collections (insert/delete/iterate) are `Set`/`Map`.
- **Design**: pure computation (no side effects, no hidden globals; DOM/xterm access read-only through injected parameters) is a standalone exported function with dependencies passed in — grid fit (`terminal/fit.ts`), IME anchor (`util/imeanchor.ts`), title state machine (`terminal/title.ts`), input parsing. Stateful objects with a lifecycle (TabManager, ConfigStore, the TerminalTab session kernel) stay classes. No abstraction layer between the two; prefer a pure function over a private method whenever the logic is unit-testable without a DOM/xterm instance.
- **Async**: `Promise.withResolvers()` over the `new Promise((resolve) => …)` executor form.
- **DOM**: never hand-roll one-off UI — use the shared components (toast / createModal / confirmDialog / attachStepper). No native `alert`/`confirm`/`prompt`. Element helpers live in `ui/dom.ts`: `el()` (the ONE copy — no new duplicates) and the `html`` tagged template: interpolations auto-escape, `setHtml()` is the only sanctioned innerHTML writer, raw markup requires the explicit `raw()` hatch. App-chrome ids (index.html) are referenced via `core/dom-ids.ts`, never string literals.
- **Settings panels**: follow the create / refresh / collect contract; every panel except General starts hidden (`panel.style.display = "none"`) — forgetting this stacks the new panel over the General page (shipped once as a bug). Enable the footer Apply via the settings shell's dirty mechanism, not synthetic DOM events.
- **Tests**: one module per test file; assert observable contracts, not element counts. Time is driven by `vi.useFakeTimers()` — never real `setTimeout`/`sleep` waits in tests.

## IME composition mirror (headline feature — read the docs first)

Docs: `docs/ime-composition.md` (final design, rejected Plans A/B, and the 1px-textarea root cause). Read it before touching `imebox.ts`, the freeze proxy, or composition handling.

Key facts:

- Agent TUIs (pi, Claude Code) hide the hardware cursor (`ESC[?25l`) and draw a fake one. xterm's IME support assumes the real cursor is the input point → pinyin composition renders in a corner or nowhere.
- The mirror (`util/imebox.ts`) is **pure display**: it listens to composition events on xterm's hidden textarea and floats the composition string at the computed anchor. It never takes focus, never injects text; committed text travels xterm's native textarea → onData → PTY path.
- Anchor chain (shared with the OS candidate window): `_imeAnchorCell()` (inverse-cell scan for the fake cursor → falls back to `CursorPositionFilter` mode position) feeds both the mirror and `_patchImeFreeze()` (textarea style Proxy that pins the hidden textarea so the OS candidate window lands right).
- **1px textarea kills real compositions** (M2 root cause): with the composition-view suppressed, xterm derives the textarea size from its (zero) bounds; the freeze proxy must clamp `width`/`height`/`lineHeight` to a full cell or TSF IMEs abort after the first keystroke.
- Enable modes: `auto` (cursor-hidden only) / `always` / `off` via `setImeMirrorMode`, persisted in localStorage. Dev-console diagnostics: `__tterm.imeTrace(on)`, `__tterm.imeDebug({suppress, reanchor})`.
- Synthetic CompositionEvent tests cannot reproduce real TSF behavior — **real-IME manual verification is the final arbiter**; e2e (`bun run test:e2e:ime`) guards the event chain and DOM behavior only.

## PTY session model

- `AppState` holds `sessions` (PTY) + `serial_sessions` + `next_id` + `initial_cwd` (from `--working-directory` CLI arg).
- Per-tab working directory: `pty_spawn` accepts an optional `cwd` (folder picker / recent-folders menu on the `+` button) which overrides `initial_cwd` and is stored in `SpawnSpec::Pty`, so in-band respawns reopen in the same directory. The NSIS installer (`src-tauri/installer-hooks.nsh`, wired via `bundle.windows.nsis.installerHooks`) registers Explorer "Open in TTerm" entries that run `tterm.exe --working-directory "<folder>"`; `open_new_window` forwards the launch cwd to new windows.
- `PtySession` stores the PTY `master` (`None` after child exit), a per-spawn `nonce` guarding the watchdog against respawn races, and the last known `size` (respawns keep it). A watchdog thread waits on `child.wait()`; on exit it sets `master = None`, closing ConPTY so the relay read pump unblocks (ConPTY never signals EOF on child death).
- All sessions share one WebSocket relay hub bound once at startup: `ws://127.0.0.1:{port}/pty/{id}?token={token}`, per-process random token, 403/404 on bad auth/route. Session death does NOT close the socket (dead mode); only `pty_kill` tears a slot down (WS Close frame). The same port also serves plain HTTP: the accept loop peeks (non-consuming) — `Upgrade: websocket` goes to tungstenite, anything else to the share API in `share.rs` (see "AI session sharing" below).

Frontend → backend commands (invoke): the single source of truth is the `tterm_commands!` macro in `src-tauri/src/lib.rs` (one list for both build profiles; debug builds append `demo_spawn`/`anime_spawn`). Notable families: `pty_*` (spawn/resize/kill), `window_*` (controls + maximize/fullscreen for zen), `read/write/delete_config_file` (per-topic JSON: config / themes / serial-profiles / keybindings), `ssh_*` + `sshclient::ssh_*` (config file, embedded client, forwards, keygen), `serial_*`, `share_*`, `tray_*`, and `open_new_window` / `pick_directory` / `save_text_file`.

Backend → frontend: WebSocket binary frames → `BatchAttachAddon`, which coalesces messages within a 6 ms window before `terminal.write()`: ConPTY splits a full-screen frame into a bare `ESC[2J` + content ~1–3 ms apart, and unbatched writes present the erase as a blank frame (flicker). Full postmortem: `docs/bugfix-fullscreen-flicker.md` — **do not remove the batching in refactors.**

## AI session sharing

Right-click a tab → Share with AI copies a self-describing HTTP URL (`/share/<id>?token=…` on the hub port): opening it returns a prompt document teaching the agent the API. `GET /screen` returns a character-level snapshot of the xterm buffer (cols/rows/cursor/`fake_cursor`/`alt_screen`/`seq`/`lines`) — the frontend is the ground truth, reached via a `share-screen-request` event + `share_screen_response` command round-trip. Plain polls are rate-limited to 1/s per share token (429); `?wait=<seq>&timeout=<s>` long-polls wake on `share_screen_changed` (frontend bumps seq on render, throttled 200 ms). `POST /input` accepts raw UTF-8 bytes or JSON `{text, keys, enter}` (named-key encoder in `share.rs`) and writes through the relay's session writer (same lock as human keystrokes). `GET /screenshot` (own 1/s limiter) has the frontend redraw the buffer on a 2D canvas — the WebGL canvas reads back blank without `preserveDrawingBuffer` — and returns PNG. Revoke = registry removal → 403.

**Gotcha**: do NOT store `tauri::AppHandle` in `WsHub` — a `Mutex<Option<AppHandle>>` field there makes the test binary fail to load with 0xc0000139. The hub uses a type-erased `emit_fn` closure set in `setup()` instead.

**Gotcha**: `share_create` validates the session via `session_exists`, which must check ALL THREE session tables (`sessions` / `serial_sessions` / `ssh_sessions`) — the embedded SSH client landed later and its table was missing, so sharing an embedded SSH tab failed with "no such session". Any new session kind needs its table added there.

## Embedded SSH client: forwards & key management

Full design: `docs/ssh-client.md` (architecture, auth chain, host-key TOFU,
forward kinds, key management, frontend surfaces, test strategy). Operational
gotchas that bite during changes:

- **Runtime forwards** live in `SshSession.forwards` keyed by backend
  `forward_id`. `ssh_forward_add` RETURNS that id — every surface that keeps
  a local row must store it back onto the row, or `ssh_forward_remove` is
  later called with `undefined` and serde rejects it (this exact bug shipped
  and was caught by the quick-panel add→delete regression test).
- **Config-defined forwards** are applied on embedded connect
  (`TabManager._applyConfigForwards`) and appear in the quick panel like
  runtime ones; panel deletion doesn't touch the config — they return on
  reconnect.
- **External ssh (system OpenSSH) cannot be managed** — `pty_spawn_ssh` is a
  bare `ssh user@host` child with no ControlMaster, so the UI hides the
  feature on those tabs: the context-menu item and quick-panel block are
  suppressed, and the forwarding dialog probes `ssh_forward_list` first and
  toasts instead of opening. This is by design (not a key scenario); config
  forwards still work there because OpenSSH reads `~/.ssh/config` itself.
- **Gotcha — exec EOF race**: sshd delivers a fast command's stdout EOF
  BEFORE it reaps the process and sends exit-status. `exec_capture` must
  keep reading until channel Close; breaking on Eof loses the exit status
  randomly and made remote-shell detection fail flakily. The in-process
  test server reproduces the sshd ordering (eof → exit-status → close).

## Disconnect & reconnect

Backend-managed and in-band (`deadmode.rs` + relay dead mode): on byte-stream end the relay keeps the socket alive, resets terminal modes (wrapped in save/restore cursor because `ESC[?1049l`/`ESC[?6l`/`ESC[r` home the cursor), prints a timed "Press Enter to reconnect" notice into the scrollback, and a `DeadWatcher` respawns on Enter. PTY respawn injects `resume_scroll` bytes first because a fresh ConPTY always opens with `ESC[2J`. A `session-state` event drives the tab-label strikethrough — the only frontend involvement. Transport-level drops (1006) trigger silent re-attach with backoff (`util/disconnect.ts`).

**Clean exit auto-closes the tab** (exception to the above): the PTY watchdog reports the child's exit code on a `session-exited` event; on code 0 (Ctrl+D, `exit`, ssh logout) TabManager closes the tab instead of leaving the dead-mode prompt. Non-zero exits (crash, external-ssh network drop) keep the prompt and Enter-respawn path. Serial/embedded-SSH sessions have no child process, so they always stay on the dead-mode path.

**Auto-reconnect** (quick panel toggle): `AppState.auto_reconnect` holds a per-session `Arc<AtomicBool>` shared with `ReconnectHooks.auto_retry`; while set, the dead-mode pump also retries `respawn` every 3 s WITHOUT Enter, and failed attempts print nothing (for serial sessions the failed open IS the unplug detection). The flag survives respawns and is removed only on tab kill. Serial `serial_set_baud` keeps the respawn spec in sync so a reconnect uses the current baud.

## Tab system

- `TerminalTab.show()` — `display:""`, add `active`, `terminal.focus()`. `hide()` — `display:"none"`, sets `needsResize = true` (show does NOT fit).
- `TabManager.switchTo(id)` — closes settings first if open; re-shows a tab hidden by settings. `toggleSettings()` opens only.
- Closing the rightmost tab must fall back to the previous tab: `#new-tab-group` is the last flex item inside `#tabs`, so sibling scans must skip anything without a live tab id (regression covered in `e2e/specs/app.e2e.js`).
- Tab drag reorder: SortableJS on `#tabs` (`forceFallback: true` — native HTML5 DnD is unreliable in WebView2), `onEnd` rebuilds the tabs Map from DOM order.
- Tab titles track OSC title sequences. A user rename (inline edit in the tab label — no native prompt) sets `titleLocked` and OSC updates stop; committing an empty name clears the lock and restores the last OSC title. Internal label refreshes (e.g. serial baud display) call `rename(name, false)` so they never lock.
- Window resize: all tabs marked dirty; only the active tab is fitted immediately (debounced).
- MRU order (`TabManager._mru`, updated on switch/pruned on close) drives the Ctrl+Tab switcher.
- The welcome watermark is a **permanent backdrop** (`#welcome`: absolute, `pointer-events:none`, z-index 0, ~8% opacity) — terminal instances and the settings page cover it with opaque backgrounds (z-index 1). There is NO show/hide state anywhere; "no tabs left" simply uncovers it. Do not reintroduce `_showWelcome`-style toggles (they caused the settings/welcome stacking bugs).

## Known limitations

- **Multi-window config writes are last-write-wins per key**: each window owns a configStore and writes per-topic JSON files; `write_config_file` is atomic (tmp+rename) and the config.json write path re-reads+merges at write time, so concurrent writes to DIFFERENT keys survive — a same-key collision still resolves last-writer-wins (impact: one settings item). Whole-document topics (keybindings/themes) replace rather than merge by design (merge would resurrect deleted entries). Accepted — no cross-process config coordination exists (tray coordination is file-based, config is not).
- **Debug builds are config-isolated by design** (not a limitation, an invariant): `config::app_data_dir()` redirects ALL app-owned state to `%APPDATA%/com.rede.tterm/dev/` under `cfg!(debug_assertions)` — tauri dev / e2e / test binaries never touch the installed release's config, keybindings, themes, serial profiles, or tray registry. The window-state plugin alone still shares the parent dir (window geometry only). Keep every new app-owned file behind `app_data_dir()`.

## Keyboard shortcuts

- Command registry + combo parsing + global dispatcher: `core/keymap.ts`. One window-level **capture-phase** keydown listener intercepts bound combos before xterm's textarea eats them (Ctrl+W, Ctrl+Tab are terminal input otherwise). Handlers are injected from `main.ts` (`initKeymap`) — keymap never imports TabManager.
- User overrides persist to **keybindings.json** (VS Code parity) via configStore's `keybindings` key (`{commandId: combo}`, `""` = unbind); effective = registry defaults merged with overrides (`resolveKeybindings`). Combo grammar: lowercase, `ctrl+alt+shift+meta` order, e.g. `ctrl+shift+tab`. Legacy `keybindings` inside config.json is migrated to the file on first load.
- Defaults: Ctrl+P quick open, Ctrl+Tab / Ctrl+Shift+Tab MRU switching, Ctrl+W close tab, F11 browser-style fullscreen (covers the taskbar), Shift+F11 zen mode (maximized); **Terminal: Clear ships unbound**. Ctrl+D is deliberately NOT captured — it reaches the shell and ends the session (see clean-exit auto-close above).
- Tab switcher overlay: `ui/tabswitcher.ts`. Ctrl+P = input + numbered list (digit query = tab number, else label substring); MRU mode = no input, each keydown steps, commit on release of the LAST binding modifier (derived from the next/prev-tab bindings, not hardcoded Ctrl), Escape cancels, window blur commits.
- Zen/fullscreen (`ui/window.ts`): one chrome-hiding state machine (`body.zen-mode` hides `#tab-bar`), two window modes — `toggleFullscreenMode()` (fullscreen via the custom `window_set_fullscreen` command) and `toggleZenMode()` (maximize via `window_maximize`). The JS Window API maximize/fullscreen is NOT in our capabilities — always use the window.rs commands. A manual unmaximize/fullscreen-exit drops the mode (onResized check, per-mode `isMaximized`/`isFullscreen`, 600 ms transition grace). FULLSCREEN is excluded from window-state persistence so the app never relaunches into a chrome-less fullscreen.
- **Font-change refit**: a newly chosen webfont family loads lazily — the first fit after a font change can measure FALLBACK metrics and leave the grid oversized (bottom clipped, worst when maximized). Two guards: `triggerResize()` runs a double-rAF settle re-fit (`fitDeferred`), and the config subscriber in `main.ts` re-fits after `document.fonts.load(primary)` resolves.
- Settings panel: `settings/shortcuts.ts` (VS Code-style table, click-to-record capture, conflict refusal, per-row reset). The capture input calls `suspendKeymap()` so recorded combos don't fire commands; edits collect into the footer Apply like every other panel.

## Fit & hysteresis

`TerminalTab.fit()` uses `hysteresis(floatVal, current, th_low, th_high, min=2)` (`util/hysteresis.ts`) — cols grow only past 90% of a char, rows never grow past floor. Pure function; avoids oscillation from intermediate resize frames. `fitDeferred()` uses double-rAF and aborts if hidden.

## Font system

- `util/fontconfig.ts` holds `fontStack: string[]` (no CSS quoting). `buildFontFamily()` quotes names with spaces and appends `monospace` at the CSS boundary; `parseFontFamily()` reverses. `monospace` is never stored in config.
- Default stack: `["JetBrains Mono", "Noto Sans SC", "Noto Sans JP", "Noto Sans KR", "Consolas"]` (per-script CJK fallback).
- **Nerd Fonts are NOT embedded** (the patched builds aged badly with incomplete glyph sets). Only standard fonts ship via @fontsource; users install NF at the OS level and the picker's system-font enumeration lists them — per-user installs included (Windows' default non-admin install). Do not re-embed NF files.
- **Web font loading race**: xterm measures cell metrics during `terminal.open()`; if web fonts aren't loaded yet, metrics are cached wrong. `TabManager` waits for `document.fonts.ready` and re-toggles `fontFamily` before showing the first tab. Do not remove.

## Terminal rendering gotchas

- **Never** add `will-change: transform` or `transform: translateZ(0)` on `.terminal-instance .xterm` — forces GPU compositing, causes sub-pixel glyph gaps.
- **Always** keep `outline: none !important` on `.terminal-instance .xterm textarea:focus`.
- `.xterm-viewport` MUST keep `overflow-y: scroll` (custom 4px overlay scrollbar).

## Right-click behavior

| Trigger | Action |
|---|---|
| Right-click on **tab** | Tab operations menu (incl. Share with AI + Port Forwarding…) |
| **Shift+right-click** on terminal | Content operations menu |
| Right-click on terminal (no shift) | Copy if selection, else paste |
| **Shift+click** the `+` button | Folder picker → shell starts in that directory |
| Right-click the `+` button | Recent-folders menu (+ Browse…) |

Terminal right-click uses capture phase; copy uses `execCommand("copy")` + hidden textarea (not `navigator.clipboard`) to avoid the permission prompt; a global `contextmenu` preventDefault blocks native menus. Serial baud/newline controls are NOT in the content menu — they live in the quick panel (below).

## UI feedback components (mandatory shared pieces)

Operation feedback must go through the shared components — never hand-roll a
one-off prompt for a single feature. Four pieces cover every case:

- **Transient notice** → `showToast` (`src/ui/toast.ts`), the ONLY toast.
  Long-running operations (SSH connect, update download) keep a toast up and
  clear it with the returned `ToastHandle.dismiss()`. A user *aborting* their
  own action (e.g. cancelling the SSH password prompt — backend marks it
  "cancelled") is NOT an error: no error toast.
- **Modal dialog** → `createModal` (`src/ui/modal.ts`): overlay + Escape +
  backdrop dismissal + singleton-per-class. Every dismissal path must run
  the same cancel logic (`onClose`) — an unanswered backend prompt wedges
  the caller (see sshauth).
- **Yes/no question** → `confirmDialog` (`src/ui/confirm.ts`), built on
  createModal + the sshauth dialog styles. Native OS dialogs are banned in
  the frontend (`@tauri-apps/plugin-dialog` is not a dependency); dismissal
  resolves `false` — a dismissed question never confirms.
- **Number input** → `attachStepper` (`src/ui/stepper.ts`) wraps the input
  with styled −/+ buttons; native spinner buttons are hidden globally in
  CSS (they render with the platform look). Steppers dispatch bubbling
  `input`+`change` so settings dirty-tracking keeps working.
- **Per-session quick actions** → the quick-status panel
  (`src/terminal/quickpanel.ts`), opened from the button at the right end of
  the tab bar. Like contextmenu it never imports TabManager: actions go
  through injected handlers (`setQuickPanelHandlers` in main.ts).

When two surfaces drive the same backend operation, the operation + its
error wording live in ONE module — e.g. `forwarding.ts`
(`listForwards`/`addForward`/`removeForward`/`validForwardPorts`) serves both
the forwarding modal and the quick panel. Add a third surface by importing,
never by copying.

Dropdown menus (profile menu, directory menu, tab context menu, quick panel)
share the same visual tokens (`#252526` surface, `#3e3e42` border) — reuse
the existing classes/tokens for new popups.

## Quick-status button & panel

`#quick-status` sits between `#drag-spacer` and `#window-controls` (the 1 cm
margin on `#window-controls` keeps it off the minimize button). Its dot
reflects the active tab: red = session down, blue = AI-shared
(`updateQuickButton()` is called from TabManager switch/close/share and the
`session-state` listener; switching tabs closes the panel). Panel content
follows the active tab's type: AI share toggle for all, SSH adds
auto-reconnect + inline port forwards (embedded client only, compact
single-line table), serial adds
auto-reconnect + profile/baud/newline selects + an always-visible
modem-line block (RTS/DTR toggles, live CTS/DSR status).
**Modem-line policy**: open asserts DTR (PuTTY / Tabby / pyserial — Pico
and other CDC devices gate traffic on it) and leaves RTS deasserted.
ESP32-C3/S3 USB-Serial/JTAG (TRM CDC-ACM table) resets **only** on
`RTS=1` and `DTR=0` (`rst:0x15`), including a DTR falling edge while RTS
is asserted. `RTS=1` with `DTR=1` is idle; DTR edges with `RTS=0` only
set/clear the download-mode flag. Do not pass through `(RTS=1, DTR=0)`
except when the user explicitly toggles it. Windows `SetCommState` (live
baud / flow change) drops DTR, so the pump deasserts RTS first, then
restores DTR (then RTS if we were driving it). Hardware RTS/CTS: the
driver owns RTS — software `SetRts` is ignored and the quick-panel RTS
toggle is disabled; DTR stays software-controlled. A live **profile**
switch is byte-stream only and must not call `serial_set_flow_control`.

## System tray (park window)

Parking is an explicit PER-WINDOW action — the park button (`#btn-park-tray`, PanelBottomClose icon, immediately left of minimize) hides the window into the tray while its sessions keep running (background agents on long tasks). It is deliberately NOT a close-button behavior: each window's content is the user's choice, and the X button still closes for real. `tray_park_window` → `tray::park_window`.

One tray icon is shared by ALL windows, but TTerm windows are separate PROCESSES (`open_new_window` spawns the exe), so coordination is file-based under the app config dir — no IPC server:

- `tray-windows.json` — parked-window registry `[{pid, tabs, since}]`; `tray-owner.lock` — owner pid by atomic create (dead owner replaced by the next parking process); mutations under an advisory `tray.lock` spin-retry sidecar.
- The owner keeps the tray icon and reconciles every 2 s: prune dead pids, prune windows visible again (5 s grace for fresh entries — Tauri's `hide()` is dispatched to the main thread and a just-hidden window can still read visible), rebuild the menu, tear the tray down when empty.
- Menu layout: one submenu per parked window — `<Name>#Tab M` (Name = a memorable programming-language word assigned on first park, unique among parked windows, sticky per process; M = tab count) — listing that window's tab labels; clicking a tab restores the window AND activates that tab. Plus `Quit TTerm` (terminates every parked process; shells die with it).
- Tab activation handoff: same-process restore emits `tray-activate-tab`; cross-process restore writes `tray-activate-<pid>.json` (only the target process can switch its own tabs) and the target's frontend picks it up via `tray_take_pending_tab` on `onFocusChanged`. Parked entries' tab lists are refreshed by every `tray_set_tabs` so submenu indices stay aligned.
- **Gotcha**: the TrayIcon is created ONCE per process; afterwards only `set_visible`/`set_menu` change. Drop-and-recreate cycles left duplicate icons in the notification area (restore → re-park showed two). Only the lock-file owner may show an icon — reconcile hides it otherwise; that invariant keeps a single shared slot.
- Tab labels come from the frontend, debounced 400 ms (`src/core/traytabs.ts`): TabManager registers a provider, TerminalTab notifies on rename/OSC title, TabManager on switch/close. `tray_set_tabs` also sets the native window title to the active tab's label.
- **Gotcha**: a TTerm process owns SEVERAL top-level windows (ConPTY `PseudoConsoleWindow`, `Tao Thread Event Target`, IME, `tray_icon_app`) that stay visible when the real one hides — `hwnd_of_pid` must filter by the `"Tauri Window"` class.
- Cross-process restore needs no cooperation: `EnumWindows` by pid → `ShowWindow` + `SetForegroundWindow`.
- Dev-mode artifact: with the vite dev server, its reload broadcast can recreate a hidden window's WebView — production (embedded dist) never reloads, and the grace period + class filter absorb it anyway.

## Settings page

Lazy-loaded via `import("./settings")` on first open. Sidebar layout, six panels (General / Appearance / Profile / SSH / Serial / Keyboard). Footer: feedback text + Revert + Apply (Apply grays out after save, re-enables on change). Settings tab uses `data-tab-id="#settings"`, excluded from badge counting. All settings reads/writes go through `configStore` (`src/core/store.ts`) — schema + defaults live there in one declarative table. Persistence is per-topic JSON files via the generic `read_config_file`/`write_config_file` commands (whitelist: config / themes / serial-profiles / keybindings); **Rust does raw I/O only — parsing, merging, and migration are frontend concerns**.

## Profile loading flow

1. SSH — Rust reads `~/.ssh/config` raw; frontend parses Host entries with wildcard inheritance and generates the file back (keys preserve original casing).
2. Windows Terminal profiles — Rust returns raw `settings.json` + fragment JSONs; frontend parses. Profiles without `commandline` resolve via `source`: VisualStudio (vswhere), Wsl (`wsl.exe -d`), Azure (`wt.exe -p`); unrecognized sources are dropped.
3. Default profile priority: user-set → first profile → cmd.exe fallback.

## Custom window decorations

No native title bar (`decorations: false`). The tab bar is the title bar: tabs left, `#drag-spacer[data-tauri-drag-region]` center, then the quick-status button, then window controls right. Drag starts only after actual mouse movement (so `dblclick` can still toggle maximize). Maximize icon toggles via `.restore` CSS class. Vite dev server binds `127.0.0.1` explicitly (IPv6 loopback is broken on Windows) — same for `devUrl`, never `localhost`.

## E2E testing

`wdio → tauri-driver(:4444) → msedgedriver → WebView2`. Read `docs/testing.md` before modifying; on this repo a skill file (`.pi/skills/tauri-e2e-testing/`) catalogs the fatal pitfalls (IPv6, driver version match, process-tree cleanup, WebDriver element quirks). Run focused specs: `bun run test:e2e:ime`, `bun run test:e2e:anime`, `bun run test:e2e:share`, or `--spec e2e/specs/app.e2e.js`. Debug introspection: `window.__tterm` (dev builds only) exposes `tabs`, `mgr`, IME debug hooks.

## Icon generation

App icon source is `src/assets/tterm.svg`. Regenerate platform icons with the `sharp`-based one-liner kept in git history / release docs (`src-tauri/icons/` targets incl. multi-size `icon.ico`).

## Shell syntax: Bash vs PowerShell

Windows host: match syntax to the shell your tool calls actually land in. A POSIX shell on Windows is typically git-bash (`grep`, `tail`, `&&`); PowerShell uses cmdlets (`Get-Content`, `Select-Object`). Never mix. Note: git-bash mangles `taskkill /pid` flags (treats `/pid` as a path) — use `powershell Stop-Process -Id <pid> -Force` for cleanup.

## Git commits

Plain double-quoted `-m` message (no PowerShell here-strings — they inject a leading `@`). Add your agent identity trailer, e.g. `Co-Authored-By: <agent> <noreply@...>`.

## Documentation principles

Changelog, release notes, and user-facing docs are written for **users, not contributors**: product features, not code details (no file/function/struct names); one line per user-visible change; fixes describe the symptom; terminology matches the UI. Internal work gets one summary line at most. Technical postmortems and design docs live in `docs/` and are the place for implementation detail.

## Release process

**Version bump** — update all three: `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `package.json`. (Safety net: the release workflow syncs all three from the tag name before building, so installer filenames and the updater manifest always follow the tag even if a bump was missed — still bump them so dev builds report the right version. Verify the bump actually landed: `grep '"version"' package.json src-tauri/tauri.conf.json`.)

**Tag and release** — first add a `## vX.Y.Z` section to the top of CHANGELOG.md (the release workflow extracts the first `## v` section as the GitHub Release body), then commit, tag, push:

```sh
git tag -a vX.Y.Z -m "vX.Y.Z"
git push origin main && git push origin vX.Y.Z
```

IMPORTANT: The tag MUST point to a commit that includes the updated CHANGELOG.md. The release workflow (`.github/workflows/release.yml`) triggers on `v*` tags and builds NSIS/MSI installers.
