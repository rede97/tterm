# Serial profiles — design

Status: implemented. Replaces per-device parameter memory with named profiles.

## What changed (user-facing)

- **No more connection history.** Per-device remembered params
  (VID:PID-keyed `serialPortParams`) are gone. Settings → Serial keeps only
  the default baud rate; everything else lives in profiles.
- **Profiles** bundle the session behavior: input mode, Enter terminator,
  output newline conversion, and flow control. Built-ins:
  - **Normal** — direct interactive mode for shells/TUIs (uboot, UEFI):
    keystrokes go straight through, Enter sends CR, no output conversion.
  - **Log** — for recording device output: bare LF is converted to CRLF so
    prints don't staircase.
  - **AT** — modem-style: local echo on, Enter sends CRLF.
- **Custom profiles** — duplicate any profile and adjust it, exactly like
  custom themes. The picker distinguishes Built-in vs Custom. Profiles are
  stored in their own `serial-profiles.json` (never in config.json).
- **Quick panel** (tab-bar ⚡) for a serial tab: switch profile, adjust baud,
  tweak the profile's parameters live, auto-reconnect toggle. Selecting a
  profile applies it to the live session immediately and shows its values.
- **Flow control** is a profile option (default off). When the active
  profile enables it, the quick panel expands a signal block: RTS/DTR
  toggles (ours to drive) and CTS/DSR live status (the device's answers).
  If the port can't report modem lines, the block is greyed out.

## Storage & config

- `serial-profiles.json` in the app config dir; raw I/O in Rust
  (`read_serial_profiles` / `write_serial_profiles`), parsing in
  `src/config/serial-profiles.ts` (mirrors custom-themes.ts).
- config.json keeps only `serialBaud` (global default) and `serialProfile`
  (last-selected profile name — global, not per-device).

## Backend (src-tauri)

- `SerialLineState` → `{ rts, cts, dtr, dsr, supported }`. `supported` is
  false when the driver can't report modem lines (read errors) — the UI
  greys the flow-control block in that case.
- `SerialCtl` gains `SetDtr(bool)` and `SetFlowControl(String)`;
  `serial_set_dtr` / `serial_set_flow_control` commands. Flow control can
  now be switched live (`serialport`'s `set_flow_control`), no reopen.

## Live-session application

`TabManager.setSerialProfile(tabId, name)` applies a profile to a running
session: input mode + Enter terminator (frontend input handler), output
newline (backend `serial_set_output_newline`), flow control (backend
`serial_set_flow_control`). Baud stays separate (it's a physical link
parameter, not a mode).
