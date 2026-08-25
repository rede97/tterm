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
`serialBaud` (global default) and `serialProfile` (Settings → Serial
default for new tabs — a live quick-panel switch does not persist).
Built-ins:

| Profile | Behavior |
|---|---|
| **Normal** | direct interactive mode for shells/TUIs (uboot, UEFI): keystrokes pass through, Enter sends CR, no output conversion |
| **Log** | recording device output: bare LF → CRLF so prints don't staircase |
| **AT** | modem-style: line-by-line editing with local echo, Enter sends CRLF, lone LF in output gains a CR |

Custom profiles are duplicates of any profile, like custom themes; the
picker groups Built-in vs Custom. `TabManager.setSerialProfile(tabId, name)`
applies a profile to a RUNNING session: input mode + Enter terminator
(frontend input handler) and output newline (backend
`serial_set_output_newline`). Baud and flow control stay separate — they
are physical link parameters (PuTTY/Tabby keep RTS/CTS with the
connection, not with newline/echo mode). A live profile switch must not
call `serial_set_flow_control`.

Opening a port applies the profile's byte-stream settings
(`createSerialTab`): `outputNewline` rides `serial_spawn` (the backend
newline converter starts in the profile's mode — there is no second
"apply" call), and `inputMode`/`enterNewline` go through the tab SETTERS,
not field assignment, because the input handler hooked in the TerminalTab
constructor captures mode + terminator by value and must be re-hooked.
`flowControl` is still sent at spawn as the open-time default (all
built-ins are `none`); custom profiles may store a different default.
Regression coverage: `tests/serial-open-profile.test.ts`.

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

Flow control (none / software XON-XOFF / hardware RTS-CTS) is a **link**
setting like baud, switchable live via `serial_set_flow_control` (no
reopen) from the quick panel — not from a live profile switch. The
signal block is always visible: RTS/DTR toggles (ours to drive,
`serial_set_rts` / `serial_set_dtr`) and CTS/DSR live status (the
device's answers). Under **hardware** RTS/CTS the driver owns RTS
(`RTS_CONTROL_ENABLE`); the RTS toggle is disabled and `SetRts` is a
no-op so software SETRTS cannot fight handshake or pair with a DTR drop
into the ESP32 USB-Serial/JTAG reset. DTR is not part of RTS/CTS and
stays software-controlled (Pico/TinyUSB still gates traffic on it).
`serial_line_status` returns `{ rts, cts, dtr, dsr, supported }` —
`supported: false` when the driver can't report modem lines, and the
block greys out. Under hardware flow, `rts` is reported as asserted
(driver-owned) regardless of the last software toggle.

At open, `open_serial` asserts DTR like PuTTY / Tabby / pyserial
(Pico/TinyUSB-class CDC devices gate traffic on DTR) and leaves RTS
deasserted. ESP32-C3/S3 USB-Serial/JTAG resets **only** on RTS=1 and
DTR=0 (TRM CDC-ACM table, `rst:0x15`) — a DTR falling edge while RTS is
asserted is that same pair. Other combinations do not reset: RTS=1 with
DTR=1 is idle; DTR toggling with RTS=0 only sets/clears the download
flag. On Windows, `SetCommState` (live baud or flow change) drops DTR;
the pump deasserts RTS first so that falling edge cannot coincide with
RTS=1, then restores DTR (and RTS if we were driving it).

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
| `MOCK-NL` | periodically emits four newline-pattern blocks (CRLF / LF-only / CR-only / mixed), each labeled with its escaped ending + the fixing mode (`[2] LF \n - cr-in-lf (Log)…`) — output newline handling |

## Testing

- Rust unit tests: parameter mapping (valid/invalid), nonexistent port
  errors gracefully, newline state-machine boundary cases.
- Vitest: menu/profile/quick-panel behavior with mocked invoke.
- E2E via the mock ports (e.g. open MOCK-LOOP, type, assert echo). Real
  hardware checks (hot-plug enumeration, TX-RX loopback, unplug
  mid-session, occupied-port error readability) are a manual checklist.
