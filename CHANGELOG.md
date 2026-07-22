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
