# Serial sessions — design

Final-state design of serial-port sessions. Supersedes the old plan /
newlines-evaluation / profiles docs.

## Architecture: serial I/O connects straight to the WS relay — no PTY

A serial port is not a PTY (no rows/cols, no process). Sessions reuse the
exact same relay model as PTY tabs:

```
xterm.js <─AttachAddon─> ws://127.0.0.1:<port> <─tokio─> serial port (COMx)
```

- **Input**: xterm → WS binary frame → port write (identical to PTY).
- **Output**: a pump thread owns the port and polls with a 20 ms timeout
  → mpsc → WS → xterm. (Early builds shared a synchronous handle and paid
  ~100 ms latency; the dedicated pump is the fix — do not regress it.)
- **Resize**: serial has no grid; frontend `pty_resize` on a serial id is a
  silent no-op.
- **Close**: tab close calls `pty_kill` uniformly; the backend checks both
  the PTY and serial session tables (cancel flag + remove).
- Parameter mapping (`map_data_bits` / `map_parity` / `map_stop_bits` /
  `map_flow_control`) is pure and unit-tested; opening a nonexistent port
  returns Err, never panics.

## Profiles: named session behavior

Session behavior is a named **profile**, stored in `serial-profiles.json`
(raw I/O in Rust via `read_serial_profiles` / `write_serial_profiles`,
parsing in `src/config/serial-profiles.ts`). config.json keeps only
`serialBaud` (global default) and `serialProfile` (last-selected name).
Built-ins:

| Profile | Behavior |
|---|---|
| **Normal** | direct interactive mode for shells/TUIs (uboot, UEFI): keystrokes pass through, Enter sends CR, no output conversion |
| **Log** | recording device output: bare LF → CRLF so prints don't staircase |
| **AT** | modem-style: local echo on, Enter sends CRLF |

Custom profiles are duplicates of any profile, like custom themes; the
picker groups Built-in vs Custom. `TabManager.setSerialProfile(tabId, name)`
applies a profile to a RUNNING session: input mode + Enter terminator
(frontend input handler), output newline (backend
`serial_set_output_newline`), flow control (backend
`serial_set_flow_control`). Baud stays separate — it is a physical link
parameter, not a mode.

## Newline handling (device → terminal)

Terminal line control is two independent actions: `CR` = cursor to column
0, `LF` = cursor down one row. xterm.js follows this strictly; devices
don't agree on line endings:

| Device sends | Untreated symptom | Typical |
|---|---|---|
| `CRLF` | fine | most MCU firmware, AT devices |
| LF only | staircase text | Unix-style firmware |
| CR only | lines overwrite each other | old devices, bootloaders |
| mixed | intermittent misalignment | multi-source logs |

Output newline conversion rewrites the stream with seven options (PuTTY/
Tabby naming): **Keep** (default), **Implicit CR in every LF**, **Implicit
LF in every CR**, **Force CRLF**, **Force LF**, **Force CR**, **Strip**
(remove CR/LF — single-line protocols, or CR/LF as binary payload).
Enter-key terminator is a separate profile option: CR (default) / LF /
CRLF.

Key implementation points (`src-tauri/src/newline.rs`):

- **1-byte state machine**: chunks can split a CRLF pair across a
  boundary, so a trailing CR is held (`pending_cr`) until the next byte
  decides. This is the only genuinely hard part and has boundary tests.
- Rewriting happens in the Rust pump thread (zero-alloc), not the
  frontend — the output path is a straight AttachAddon pipe.
- CSI/OSC sequences rarely contain bare CR/LF so the naive machine is
  safe; OSC strings (e.g. titles) containing newlines WOULD be rewritten —
  accepted risk, documented here.

## Input modes

Per profile: **Normal** (direct), **Echo** (local echo), **Line-by-line**
(local line editing, sent on Enter with the profile's terminator).
`src/util/serialinput.ts`.

## Flow control & modem lines

Flow control (none / software XON-XOFF / hardware RTS-CTS) is a profile
option, switchable live via `serial_set_flow_control` (no reopen). When
the active profile enables it, the quick panel expands a signal block:
RTS/DTR toggles (ours to drive, `serial_set_rts` / `serial_set_dtr`) and
CTS/DSR live status (the device's answers). `serial_line_status` returns
`{ rts, cts, dtr, dsr, supported }` — `supported: false` when the driver
can't report modem lines, and the block greys out.

## Quick panel & auto-reconnect

The tab-bar quick panel for a serial tab offers: profile switch (applies
live), baud select, the profile's parameter rows, flow-control block, and
an auto-reconnect toggle. While auto-reconnect is on, a dead session
retries the open on a timer without Enter — for serial sessions a failed
open simply means the device is still unplugged, so this IS the
unplug/replug detection.

## Mock ports (debug builds)

`serial_list_ports` appends two virtual ports in debug builds, going
through the full production path (menu → `serial_spawn` → pump → WS →
xterm) with zero release-build code (cfg-gated `MockSerialPort` in
`demo.rs`):

| Port | Behavior |
|---|---|
| `MOCK-LOOP` | loopback: writes echo back (baud changes echo a confirmation) — input modes, latency, baud switching |
| `MOCK-NL` | periodically emits four newline-pattern blocks (CRLF / LF-only / CR-only / mixed) — output newline handling |

## Testing

- Rust unit tests: parameter mapping (valid/invalid), nonexistent port
  errors gracefully, newline state-machine boundary cases.
- Vitest: menu/profile/quick-panel behavior with mocked invoke.
- E2E via the mock ports (e.g. open MOCK-LOOP, type, assert echo). Real
  hardware checks (hot-plug enumeration, TX-RX loopback, unplug
  mid-session, occupied-port error readability) are a manual checklist.
