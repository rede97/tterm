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
