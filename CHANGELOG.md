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
