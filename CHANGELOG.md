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
