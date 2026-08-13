## v2.2.2

Fixes

- **ESP32-C3/S3 native-USB boards no longer stay silent when the port is
  opened** — opening a serial session no longer drives any modem line.
  USB-Serial/JTAG devkits wire RTS → EN and DTR → IO0 through the
  auto-reset circuit, so asserting them held the chip in reset (or dropped
  a mid-session reboot into download mode) and the terminal showed no
  output at all. Lines are now driven only on demand: hardware flow
  control lets the driver manage RTS, and the quick panel's RTS/DTR
  toggles stay visible regardless of flow-control setting so CDC-ACM
  devices that gate TX on DTR can still be raised by hand
- **Serial default profile fully applies when a port is opened** — picking
  Log (or any profile) as the default now takes effect immediately: output
  newline conversion is handed to the backend at spawn (previously stuck on
  "keep" until switched manually), and the profile's input mode and Enter
  terminator are actually wired into the input handler (previously the
  constructor-time defaults stayed live, so AT opened with echo off and
  Enter sending CR instead of CRLF)

Changes

- **MOCK-NL blocks label their own line ending** — each emitted block now
  leads with its escaped form and the mode that renders it cleanly, e.g.
  `[2] LF \n - cr-in-lf (Log) fixes staircase`, so Output-newlines choices
  are eyeballed against all four endings at a glance
- **Output-newline help lines show just the mapping** — e.g. `\n → \r\n`
  for Log's implicit-CR mode and `\r | \n | \r\n → \r\n` for Force CRLF,
  so the conversion is readable at a glance

## v2.2.1

Changes

- **Settings keeps your place across tab switches** — open Settings, switch
  to a terminal tab and back, and your unsaved edits, active panel, and
  expanded cards are still there; closing Settings resets it as before.

## v2.2.0

Fixes

- **Serial Reconnect responds reliably** — after disconnecting a serial
  device, the Reconnect button in the quick panel no longer intermittently
  ignores the click.

Internal

- Terminal internals split into focused modules; lint warnings cleared with
  the strictest type checks now enforced; terminal handshake parsing moved
  to a hardened parser.

## v2.1.0

Changes

- **Settings and the quick panel rebuilt on a diffing renderer** — panels
  no longer rebuild from scratch on every change, so expanding an SSH host
  card, toggling an option before hitting Apply, searching in Settings →
  Keyboard, or a half-typed port forward in the quick panel all survive
  re-renders instead of being silently reset

Fixes

- **Host keys recorded in hashed `known_hosts` files can be re-learned** —
  a changed key on a `|1|…` (ssh-keygen -H) entry could never be accepted,
  locking you out of the host
- **Serial Reconnect adapts to the session** instead of waiting a fixed
  300 ms — reconnects faster, and no longer sends a stray Enter when the
  device already came back on its own
- **Tray "Quit TTerm" can no longer kill an unrelated process** — a parked
  window is verified to still be a TTerm window before it is terminated
  (PID-reuse race)
- **Config files are written atomically** — a crash mid-save can no longer
  leave a truncated `config.json` / `keybindings.json` / `themes.json`
  (settings would silently fall back to defaults)
- **SSH key install no longer garbles non-ASCII output** — a multi-byte
  character split across packets showed up as U+FFFD when probing the
  remote shell
- **Closing a blocked SSH session is now immediate** — killing a tab whose
  connection was stuck on a full channel window waited for the idle poll
  instead of interrupting the send

Internal

- Backend hard rules are machine-enforced: Biome GritQL plugins reject
  empty catch blocks and native dialogs, and import cycles are a CI error
  (two cycle clusters in the terminal module were untangled)
- `sshclient.rs` split into focused modules (prompter / hostkey / session /
  forward / keys / install); WebSocket auth token compared in constant time;
  multi-window settings merges different keys at write time; test suite
  grew to 357 frontend + 112 backend tests with the full e2e suite green

## v2.0.0

Changes

- **Embedded Nerd Fonts removed** — the bundled patched fonts were
  outdated with incomplete glyph sets. Install Nerd Fonts at the OS
  level instead; the font picker lists user-installed fonts (including
  per-user installs) and links to nerdfonts.com
- **Keybindings moved to their own file** — `keybindings.json` in the
  config directory (VS Code parity), easy to hand-edit or share;
  existing bindings migrate out of `config.json` automatically

Fixes

- **Saving SSH config no longer deletes your global settings** — the
  `Host *` block and options before the first `Host` line (ProxyJump,
  ServerAliveInterval, …) were silently dropped on Save; they are now
  preserved
- **Reset All / Revert now apply immediately** — cleared or reverted
  settings (including keybindings) previously kept their old values
  until the app restarted
- **Multi-line paste warning works** — the setting existed but was never
  enforced; pasting multiple lines now asks first (single commands still
  paste straight through)
- **F11 full screen did nothing on a maximized window** (a platform
  quirk: fullscreen only engages from a normal window) — it now drops
  out of maximize first and restores it on exit
- **Settings page no longer blanked** — closing the last terminal tab
  while in Settings used to show the empty welcome screen over it
- **Duplicating a serial tab now opens a serial session** on the same
  device (it used to open a plain shell with the port's name)
- **Rebinding a key to its default or unbinding a default could be
  silently ignored** in Settings → Keyboard
- **Ctrl+= / Ctrl++ and numpad keys can now be bound** — the `+` key
  itself and numpad variants were rejected by the combo parser
- **Quick open / tab switcher no longer stalls** when a tab closes while
  the overlay is open
- **Dev builds no longer share config with the installed app** — debug
  builds (tauri dev / e2e) keep all app state in a separate `dev/`
  subdirectory of the config dir, so testing can't mutate your real
  settings, keybindings, or tray state

Internal

- Full repository hardening pass: CI now gates on lint (Biome), typecheck,
  frontend and backend tests, and rustfmt; resource cleanup for tab
  close paths; backend prompt timeout and lock-free session respawn

## v1.0.3

New Features

- **Keyboard shortcuts, rebindable** — Settings → Keyboard lists every
  command VS Code-style: click a keybinding, press the new combination,
  Enter to confirm (conflicts are refused), Backspace to unbind, ↺ to
  restore the default. Ships with:
  - **Ctrl+P** — quick-open panel over all tabs; type a tab number or
    name, Enter to jump
  - **Ctrl+Tab / Ctrl+Shift+Tab** — hold Ctrl to step through tabs in
    most-recently-used order (backward with Shift), release to switch
  - **Ctrl+W** — close the active tab
  - **F11** — full screen, browser-style: covers the taskbar, tab bar
    hidden; F11 again restores
  - **Shift+F11** — zen mode: maximized window with the tab bar hidden
    (stays above the taskbar)
  - **Terminal: Clear** — clears screen and scrollback; unbound by
    default, bind it (e.g. Ctrl+L) in Settings → Keyboard
- **Clean shell exit closes the tab** — Ctrl+D, `exit`, or an SSH logout
  (exit code 0) now closes the tab directly instead of showing the
  "Press Enter to reconnect" prompt. Abnormal exits (crash, SSH network
  drop) still offer in-place reconnect as before

Fixes

- **Switching the font family while maximized left the terminal
  clipped** — newly chosen fonts load lazily, so the first size
  calculation used fallback metrics and the oversized grid cut off the
  bottom of the screen once the real glyphs arrived

## v1.0.2

New Features

- **Drag to reorder SSH hosts** — host cards in Settings → SSH can be
  dragged into place; the new order is kept with Save SSH Config. An
  expanded host now shows each config option on its own line
- **Unsaved SSH config hint** — after adding, editing, deleting, or
  reordering hosts, the settings footer shows "SSH Config edited —
  unsaved" until you save
- **Scroll-edge shadows on the tab bar** — while more tabs are scrolled
  out of view on a side, a shadow appears at that edge (on the right it
  hugs the always-visible + button), so it's clear more tabs exist

Improvements

- **Font picker sees per-user font installs** — fonts installed for the
  current user only (Windows' default without admin), such as a
  user-installed Nerd Font set, now appear in the font list

Fixes

- **Revert wiped the settings page**, leaving only the SSH host list
  with no sidebar or buttons
- **Apply could silently reset the default profile** to the first entry
  when saving an unrelated change; Revert could leave the profile list
  stale after Windows Terminal profiles changed on disk
- **The Built-in SSH Client toggle could be silently discarded** when
  the SSH panel re-rendered (host edit, reload, key generation)
- **Quick panel and find bar stayed open over a closed tab**, and the
  tray menu could activate the wrong tab after drag-reordering
- **Escape closed every open dialog at once** — stacked SSH auth prompts
  were all cancelled together; double-clicking a tab toggled maximize
- **Pasting multi-line text in serial line mode merged it into one
  line**, and pasted newlines ignored the configured line ending
- **Saving ~/.ssh/config could lose or duplicate forwarding rules** when
  a keyword's casing differed between entries (LocalForward vs
  localforward)

## v1.0.1

Fixes

- **SSH key upload failed on Windows targets running PowerShell with Git
  installed** — shell auto-detection mistook the host for Linux (Git's
  sh.exe answered the detection probe) and then ran Linux shell commands
  the target can't parse. Detection now tries PowerShell → cmd → sh

## v1.0.0

New Features

- **SSH key management** — Settings → SSH gains a Keys section: generate
  Ed25519 or RSA-4096 key pairs (optional passphrase), list and copy local
  public keys, and upload a public key to any configured host straight
  from its detail view (ssh-copy-id equivalent — the private key never
  leaves the machine). Works against Linux, macOS and Windows targets:
  the remote shell is auto-detected by probing sh → cmd → PowerShell, or
  you can pin the target system in the upload dialog. Note: on Windows,
  administrator accounts may require administrators_authorized_keys

Improvements

- **Easier port-forward entry** — the target host is now optional and
  defaults to 127.0.0.1 (the most common target); input placeholders show
  the default so it's discoverable. The quick panel's forward list is a
  compact single line per forward — listen port and target aligned with
  the input row below, a divider between them, and icon buttons

Fixes

- **Deleting a forward added mid-session failed with an error** — freshly
  added rows were missing their server-side id, so removal was rejected
- **SSH key upload could fail with "could not detect the remote shell"** —
  a race in remote command replies (EOF arriving before the exit status)
  made shell detection flaky

## v0.13.0

New Features

- **SSH host editor** — Settings → SSH now has a real editor window (Add
  Host / per-card Edit) instead of hand-editing `~/.ssh/config`: alias,
  hostname, user, port, ForwardAgent/ForwardX11 checkboxes, and port
  forwards. Changes land in the working copy and persist via Save SSH
  Config as before; Edit preserves directives the editor doesn't manage
  (IdentityFile etc.)
- **Port forwards as a grouped, editable table** — forwards are grouped by
  direction: Local (-L) / Remote (-R) / Dynamic (-D), each group with a
  one-line explanation and its own add row (listen side pinned to
  127.0.0.1; target placeholders locate the side: "Host (Remote)" /
  "Host (Local)"). Rows can be edited inline or deleted. The same table
  drives the quick panel's runtime forwards (compact layout) — configured
  forwards on a host are applied automatically when the embedded client
  connects (LocalForward / RemoteForward / DynamicForward in ssh config;
  the system-ssh path keeps using OpenSSH's own handling)
- **Dynamic (-D) forwards in the embedded SSH client** — a minimal SOCKS5
  listener (no-auth, CONNECT) bridging each connection to a direct-tcpip
  channel, with reconnect re-apply like the other kinds

## v0.12.2

Improvements

- **Output newlines help text** — the serial profile editor (Settings →
  Serial) and the serial quick panel now explain each output-newline mode:
  every option carries a hover tooltip, and a live help line under the
  select describes the current choice and follows changes
- **Clearer title-bar icons** — the quick-actions button is now a solid
  blue bolt, and park-to-tray uses a mask icon to suggest the window
  hiding into the tray

## v0.12.1

Fixes

- **Frozen tabs with TUIs that query private modes (e.g. omp)** — the
  production bundle mis-minified xterm.js's DECRQM handler (`CSI ? Pm $ p`):
  esbuild 0.25's logical-assignment lowering dropped a variable declaration
  (esbuild #4508), so the first private-mode query threw an uncaught
  ReferenceError that permanently killed the terminal's write/parse loop.
  The tab froze with a stale frame while input, SSH and the remote process
  kept working; only dev builds were unaffected. Build target is now ES2022
  (no such lowering; WebView2/WKWebView have supported it for years).
  Regression covered at three levels: vitest parser replay of the captured
  byte stream, a Rust SSH-flood transport test, and an e2e spec that
  replays the stream through the live WebSocket path (debug and release
  variants)

## v0.12.0

New Features

- **Serial profiles** — session behavior is now a named profile: Normal
  (interactive shells and embedded TUIs like uboot/UEFI), Log (records
  device output, LF becomes CRLF), and AT (local echo, Enter sends CRLF).
  Duplicate any profile to create your own — stored in a separate
  `serial-profiles.json`, with Built-in and Custom sections in Settings →
  Serial. Per-device connection history is gone; settings keep only the
  default baud rate and default profile
- **Serial quick panel rework** — switch profile and baud on the fly, tweak
  the profile's parameters live for the current session, and keep the
  auto-reconnect toggle. Profiles with flow control expand a signal block:
  RTS/DTR toggles and live CTS/DSR status (greyed out when the port can't
  report modem lines)
- **Release the serial port without closing the tab** — Disconnect frees
  the device for other tools (Arduino uploads…), Reconnect brings the
  session back with one click
- **Title bar polish** — quick actions and park-to-tray form one equal-width
  button group set off by vertical dividers; the + and dropdown buttons
  stay pinned when the tab strip overflows; a minimum empty strip is always
  reserved for dragging the window; the quick-actions button is disabled
  while Settings is open or no tab exists

Fixes

- Notification toasts are much subtler (small translucent cards with a thin
  accent bar instead of solid blocks)
- The quick panel has a fixed width — sharing a session no longer makes it
  jump wider

## v0.11.0

New Features

- **Park windows in the system tray** — a new button next to minimize
  hides the window while its sessions keep running, so AI agents and
  long-running tasks keep working in the background. All parked windows
  share one tray icon: right-click it and every window appears as
  "<Name>#Tab M" (a memorable language name like Rust, unique and kept
  across re-parks) with its tabs listed under it —
  picking a tab restores the window and jumps straight to that tab;
  "Quit TTerm" exits everything parked there

Fixes

- Restoring a parked window and parking it again no longer leaves a
  duplicate tray icon — the icon is created once per process and only
  its visibility toggles

- Number fields in Settings (font size, scrollback) now have styled −/+
  stepper buttons instead of the unstyled native spinners

## v0.10.0

New Features

- **Quick-status button** — a new button at the right end of the tab bar
  shows the active session's state at a glance (red dot while disconnected,
  blue while shared with an AI agent) and opens a quick panel:
  - every tab: AI share on/off switch with a copyable link
  - SSH: auto-reconnect switch (retries quietly in the background while the
    session is down), current port forwards with inline add/remove
  - serial: auto-reconnect switch (reconnects by itself when an unplugged
    device comes back), baud rate / newline switches, RTS line toggle and
    live CTS status. The baud/newline submenus moved here from the
    terminal's right-click menu

Fixes

- Sharing a session that runs on the built-in SSH client no longer fails
  with "no such session" — the share check now sees embedded SSH sessions
- Starting an SSH session now shows a "Connecting to…" hint right away
  instead of going silent until success or timeout
- Cancelling the SSH password prompt closes the attempt quietly instead of
  raising an error
- The update-available prompt now uses the app's own dialog style instead of
  a native system window

Internal

- UI feedback unified: all yes/no questions go through one shared confirm
  dialog, and port-forward operations (list/add/remove, validation, error
  wording) live in a single module shared by the forwarding dialog and the
  quick panel

## v0.9.1

Fixes

- Closing a tab no longer leaks its IME event listeners — repeated
  open/close cycles used to keep the whole terminal alive in memory

Internal

- Frontend cleanup: shared modal scaffolding for all dialogs, single HTML
  escaping helper, deduplicated tab-creation flow, and typed accessors for
  xterm internals (no behavioral changes)

## v0.9.0

New Features

- **Built-in SSH client** — SSH tabs no longer depend on the system ssh
  command. Passwords and key passphrases are asked in a proper dialog,
  first-time host keys get a trust-on-first-use confirmation (a changed key
  raises a loud warning), and your `~/.ssh/known_hosts` stays shared with
  OpenSSH. Prefer the old behavior? Settings → SSH → "Built-in SSH Client"
  switches back to the system ssh
- **Dynamic port forwarding** — right-click an SSH tab → "Port Forwarding…"
  to add or remove local (-L) and remote (-R) tunnels while the session is
  running; forwards are restored automatically after a reconnect
- **Custom color themes** — Settings → Appearance: duplicate any built-in or
  Windows Terminal scheme and adjust every color with live preview. Your
  themes live in their own `themes.json` next to the config file, shown in
  a separate "Custom" section of the gallery
- **Drag to reorder font fallbacks** — the font picker's "used fonts" list
  now reorders by drag & drop instead of arrow buttons

Fixes

- The strips of background around the character grid (and the frame visible
  while resizing the window) now follow the terminal's color scheme instead
  of staying dark — no more color seam with light themes

## v0.8.1

New Features

- Clickable links — Ctrl+click any web address printed in the terminal to
  open it in your browser; hyperlink text emitted by apps (OSC 8) opens
  with a plain click

## v0.8.0

New Features

- AI session sharing: agents can now type Unicode text directly — Chinese
  works — plus named keys and shortcuts ("enter", "ctrl+c", "alt+f4",
  arrows, F1–F12) via a documented JSON input form; raw-byte input still
  works and the share link's built-in help page now states clearly that
  all text must be UTF-8
- AI session sharing: image screenshots — agents can pull a PNG render of
  the shared screen in addition to the character-level snapshot
- Tab context menu items now have icons; "Share with AI", "Copy Share
  Link" and "Stop Sharing" use distinct icons

Fixes

- Chinese sent through an AI share came out garbled when the agent's
  client didn't encode it as UTF-8 — the JSON input form (Unicode by
  definition) removes the ambiguity

## v0.7.3

New Features

- **Update settings** — Settings → General → Updates now has a "Check for
  Updates" button for a manual check, and a toggle to disable the
  automatic update check on startup

Fixes

- Opening a directory (Shift+click "+" or the recent-folders menu) now
  launches your configured default profile (e.g. PowerShell) instead of
  always falling back to cmd.exe
- The main window no longer goes "Not Responding" while the folder
  picker or the save-output dialog is open — both dialogs are now
  non-blocking

## v0.7.2

New Features

- **Automatic updates** — TTerm now checks for new versions on startup
  and offers to download and install them in place, restarting itself to
  finish. Update packages are cryptographically signed; the check is
  silent when you're already up to date

## v0.7.1

New Features

- The recent-folders menu (right-click the "+" button) now has a "Clear
  history" entry

Fixes

- Typing Chinese with the cursor on the bottom row: the IME candidate
  window no longer covers the floating pinyin mirror — it opens below the
  cursor and may extend past the window's bottom edge (candidate windows
  are top-level OS windows). The right-edge safe margin stays, so the
  frame-shift fix from v0.5.2 is unaffected

## v0.7.0

New Features

- **AI session sharing** — hand any live terminal session (shell / SSH /
  serial) to a local AI agent. Right-click a tab → "Share with AI" and
  paste the link to the agent: the link itself explains how to use it.
  The agent pulls character-level screen snapshots — full screen text,
  terminal size, cursor state, even the fake cursor position in agent TUIs
  (no screenshots, no OCR) — and can type keystrokes for you. Long-polling
  wakes on screen changes, plain polling is rate-limited. You watch every
  move live, a teal dot marks shared tabs (right-click → "Copy Share Link"
  / "Stop Sharing"), and revoking cuts access instantly. Everything stays
  on 127.0.0.1 — nothing is exposed to the network

## v0.6.0

New Features

- Windows Explorer context menu: after installing (NSIS), right-click a
  folder or a folder's background to "Open in TTerm" — launches a window
  with the terminal in that directory. Removed on uninstall. (WiX/MSI
  bundles do not register the entry; use the NSIS setup.)
- The "+" button: Shift+click opens a folder picker and starts the default
  shell in the chosen directory (hovering with Shift held swaps the plus
  for a folder icon with a blue hover tint); right-click shows a
  recent-folders menu (persisted in config, most-recent first) plus a
  Browse… entry
- A tab renamed by the user no longer follows terminal (OSC) title changes;
  internal display updates (e.g. serial baud changes) still refresh the
  label without locking the title. Renaming now edits inline in the tab
  label instead of the native prompt() dialog (which showed the page URL
  as its title); committing an empty name restores OSC title tracking

## v0.5.2

Fixes

- CJK input near the window's right or bottom edge (typical in htop/btop,
  which park the cursor in a corner) no longer shifts the whole terminal
  sideways and clips the leftmost column: no element in the app has a
  horizontal scrolling mechanism anymore, and the IME caret is kept inside
  a safe margin so the candidate window never overflows the window and
  never triggers the browser's frame-shift avoidance
- Shrinking the window below the grid's pixel height now refits the
  terminal — rows shrink along with the window (previously the layout was
  pinned by the flex container's minimum content height, and only growing
  worked)
- The window now enforces a minimum size of 800×600

## v0.5.0

New Features

- Chinese, Japanese and Korean IME input now works in agent TUIs that hide
  the hardware cursor (pi, Claude Code and friends): the composition string
  floats right at the input point with the IME candidate window alongside,
  wraps as it grows, and disappears the instant you commit — previously the
  composition vanished or landed in a far corner, making CJK input in these
  apps effectively unusable

Fixes

- Full-screen apps (vim, htop, less…) no longer flash a blank frame when
  redrawing the whole screen — most noticeable at large window sizes
- Closing the rightmost tab now moves focus to its neighbor, like a
  browser, instead of leaving a blank window

## v0.4.0

New Features

- Disconnect handling is now built into the terminal itself: when a session
  ends (shell exit, SSH drop, serial unplug), the terminal resets to a sane
  state, prints the time it happened, and offers Enter to reconnect — no
  overlay, all scrollback stays visible and copyable, and reconnecting never
  requires the mouse
- Sessions now survive sleep/wake and app switching: a dropped connection is
  re-established silently in the background, with anything printed in the
  meantime preserved — local shells no longer show a false disconnect
- Tabs are now always the same width: they share the tab bar evenly
  (capped at a reasonable size, shrinking together as more are opened,
  like Windows Terminal), and hovering a tab shows its full name

Fixes

- Reconnecting no longer loses the screen: the previous screen and
  the disconnect prompt are kept in the scrollback before the new shell
  starts
- Reconnecting after a TUI app (vim, htop…) died no longer leaves the
  terminal stuck on the alternate screen
- A reconnected session now opens at the current terminal size instead of
  80×24

## v0.3.0

New Features

- Serial settings panel: a dedicated home for serial — default baud rate and input mode,
  per-device settings for connected ports, and a history of remembered devices with Forget
- Serial input modes: Normal (send keys directly), Echo (local echo), and Line by Line
  (edit locally with backspace, send the whole line on Enter)
- Output newlines: seven modes (Keep, Implicit CR in every LF, Implicit LF in every CR,
  Force CR/LF/CRLF, Strip) for devices with unusual line endings — switchable live from
  the context menu without reconnecting
- Device memory now matches USB adapters by VID:PID, so per-device settings follow the
  device even when its COM number changes
- Theme gallery: every color scheme is shown as a live preview card, so you can pick
  at a glance instead of cycling a dropdown

Fixes

- Theme previews now render in the same font as the terminal (previously a generic
  monospace font, which did not match the real look)

Notes

- Debug builds enumerate two mock serial ports (loopback echo and newline patterns)
  for hardware-free testing

## v0.2.0

New Features

- Serial port terminal: device enumeration (USB VID/PID, two-line menu items), full-duplex
  sessions over the shared WebSocket relay, live baud switching from the context menu,
  per-port parameter memory, DTR/RTS assertion for CDC-ACM devices (debug probes),
  busy/unplugged error toasts
- Color schemes: 12 built-in themes (Solarized, Dracula, Nord, Gruvbox, One Half, Monokai,
  Tokyo Night...), automatic Windows Terminal scheme import, live preview in Settings
- Session reconnect for local/SSH/serial: disconnect overlay + strikethrough tab label,
  press Enter to respawn the session in place
- Tab drag reorder via SortableJS with 150ms animation
- OSC 9;4 progress bar on tabs (normal/error/warning/indeterminate)
- Toast notification system; all user-facing errors unified through it
- Terminal size hint overlay (centered, terminal font stack)
- Demo TTY (debug builds): animated TUI + OSC 9;4 demo for testing

Fixes

- Serial loopback latency: single-owner I/O pump thread replaces concurrent handle I/O
  (Windows serializes ReadFile/WriteFile on synchronous handles, stalling writes ~100ms)
- Dragged tab disappearing when the mouse was released outside the window
- Tab click dead zones: window-drag swallowing clicks after pointer jitter; horizontal
  scrollbar strip overlaying the bottom pixels of tabs
- SSH config Host * wildcard leaking as a regular host when not the last block
- Hysteresis could return 0 columns on tiny containers (degenerate grid)
- ConPTY never signals EOF on child exit: watchdog thread now detects session death,
  enabling disconnect detection and reconnect

Improvements

- Rust backend split from one 1300-line file into 12 focused modules with colocated tests
- Three-layer test framework: 37 Rust + 74 Vitest unit/DOM cases + 8 tauri-driver E2E
  cases driving the real app window (docs/testing.md)
- Dead code removal (pty_write command, orphaned modules, unused dependencies)
- E2E pitfalls documented as a reusable pi skill (.pi/skills/tauri-e2e-testing)

## v0.1.5

Fixes

- Fix horizontal scroll drift: overflow-y:scroll on xterm viewport implicitly forces overflow-x:auto,
  causing accessibility tree row elements to trigger unwanted horizontal scrollLeft that clips
  terminal content on the left side
- Fix IME candidate window position drift: align-content:center created a vertical offset between
  JavaScript-computed cursor coordinates and actual visual grid position, causing the IME composition
  window to appear above the real cursor. Switched to align-content:end (bottom-aligned grid) matching
  VS Code's approach

## v0.1.4

New Features

- Font management system with built-in & system font picker, live xterm preview, drag-free reorder
- Nerd Font built-in typefaces (DroidSansMono NF, UbuntuMono NF)
- Noto Sans SC/JP/KR as default CJK fallback fonts for pan-CJK coverage
- SSH config editor in Settings: host visibility toggles, expand details, edit, save, clear known hosts
- Settings lazy-loading via dynamic import for faster startup (~20KB smaller main bundle)
- Window title updates from terminal (onTitleChange)
- Korean and Japanese preview samples in font picker

Fixes

- Fix first-tab wide character spacing caused by web font loading race
- Fix Reset All / Revert not syncing in-memory font stack
- Fix terminal not auto-resizing after font changes in settings

Improvements

- Four-panel settings layout (General, Appearance, Profile, SSH)
- Preview terminal with scrollback buffer and custom scrollbar
- Profile visibility toggles for both WT profiles and SSH hosts
- README icon and CI badge

## v0.1.3

New Features

- Three-tab settings layout — General, Appearance, and Profile panels with sidebar navigation
- Renderer selector — Switch between WebGL and Canvas rendering backend
- Scrollback buffer size — Configurable scrollback lines (default 20,000)
- Paste options — Multi-line paste warning and whitespace trimming
- Tab width mode — Equal (uniform width) or Adaptive (fit title text)
- Copy as HTML — Copy terminal selection with terminal-themed HTML formatting
- Open in New Window — Launch a new app window from context menus and command palette
- Azure profile support — Azure Cloud Shell profiles resolved via wt.exe
- Pre-defined context menus — Menus built once with event delegation instead of rebuild per click

Fixes

- Hidden profiles now remain visible in settings panel (can be re-enabled)
- Terminal bell positioned correctly in Terminal section
- Config file properly deleted on reset instead of writing empty object
- Imported profiles show command text and visual separation

Improvements

- Hysteresis-based terminal fit algorithm (avoids resize oscillation)
- Custom scrollbar overlay (4px, expands on hover)
- Bottom-aligned xterm grid
- Tab bar height reduced to 32px
- Zero vite build warnings
