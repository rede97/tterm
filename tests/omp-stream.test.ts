import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Terminal } from "@xterm/xterm";

/**
 * Regression tests for issue rede97/tterm#1:
 * Running `omp` (oh-my-pi) in a TTerm SSH tab froze the tab's rendering the
 * moment the TUI started painting. The reporter confirmed the freeze is
 * triggered purely by omp's startup byte stream: replaying the captured
 * 93,723-byte stream in a tab wedges it mid-stream, and the success marker
 * printed after the replay never appears on screen.
 *
 * The fixture is the exact byte stream attached to the issue (kept raw so the
 * Rust backend tests include the identical bytes via include_bytes!).
 * These tests pin the contract the parser/render pipeline must satisfy:
 *  - writing the stream must always complete (write callback must fire —
 *    if the parser ever wedges, the promise never resolves and vitest's
 *    test timeout reports the hang)
 *  - every terminal query in the stream must be answered (DA / DECRQM)
 *  - the terminal must stay functional after the replay (later output lands
 *    in the buffer — the "=== REPLAY FINISHED ===" marker scenario)
 *  - each suspected trigger sequence must complete in isolation, so a future
 *    regression can be bisected by which test fails
 *
 * Note: the original freeze was observed with the webgl renderer, which
 * cannot run under happy-dom; the headless parser level is what vitest can
 * cover.
 */

const stream: Uint8Array = readFileSync(join(__dirname, "fixtures", "omp-startup-stream.bin"));

// Options mirror the parser-relevant Terminal construction in src/terminal/tab.ts.
function makeTerminal(): Terminal {
  return new Terminal({
    allowProposedApi: true,
    cursorBlink: true,
    scrollback: 1000,
    cols: 120,
    rows: 30,
  });
}

/**
 * Await xterm's write completion callback. No watchdog timer: if the parser
 * ever wedges, this promise stays pending and vitest's test timeout reports
 * the hang — the frozen-tab failure mode.
 */
function writeAll(term: Terminal, data: Uint8Array | string): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  term.write(data, resolve);
  return promise;
}

function bufferText(term: Terminal): string {
  const buf = term.buffer.active;
  const lines: string[] = [];
  for (let i = 0; i < buf.length; i++) {
    lines.push(buf.getLine(i)?.translateToString(true) ?? "");
  }
  return lines.join("\n");
}

describe("omp startup byte-stream replay (issue #1)", () => {
  it("fixture is the exact 93,723-byte stream from the issue", () => {
    expect(stream.length).toBe(93723);
  });

  it("writes the full stream without wedging the parser", async () => {
    const term = makeTerminal();
    await writeAll(term, stream);
  });

  it("consumes the stream to the very end (no mid-stream stall)", async () => {
    const term = makeTerminal();
    await writeAll(term, stream);
    // The capture's final line is script(1)'s footer; if the buffer holds it,
    // the entire stream was parsed — in the frozen tab rendering stopped
    // mid-stream and nothing after the freeze point ever appeared.
    expect(bufferText(term)).toContain("Script done on 2026-08-09");
  });

  it("answers every terminal query in the stream (DA + DECRQM)", async () => {
    const term = makeTerminal();
    const replies: string[] = [];
    term.onData((d) => replies.push(d));
    await writeAll(term, stream);

    // The stream sends ESC[c (Device Attributes) 7 times, interleaved with
    // the queries; each must get a reply.
    const da = replies.filter((r) => r === "\x1b[?1;2c");
    expect(da).toHaveLength(7);

    // Every DECRQM private-mode query omp sends must get a DECRP reply —
    // a query left hanging is suspected trigger #1 in the issue.
    for (const mode of [2026, 2031, 2048, 1010, 1011]) {
      const reply = replies.find((r) => new RegExp(`^\\x1b\\[\\?${mode};\\d\\$y$`).test(r));
      expect(reply, `DECRP reply for mode ${mode}`).toBeTruthy();
    }
  });

  it("stays functional after the replay (subsequent output reaches the buffer)", async () => {
    const term = makeTerminal();
    await writeAll(term, stream);
    // In the frozen tab this marker never appeared even though the remote
    // shell printed it; the terminal must accept output after the stream.
    await writeAll(term, "=== REPLAY FINISHED ===\r\n");
    expect(bufferText(term)).toContain("=== REPLAY FINISHED ===");
  });
});

describe("suspected trigger sequences in isolation (issue #1 bisect table)", () => {
  const firstTruecolor = stream.indexOf("\x1b[38;2;");

  it("fixture actually contains the truecolor burst after the queries", () => {
    expect(firstTruecolor).toBeGreaterThan(0);
  });

  // Each row is one suspected trigger from the issue. Every write must
  // complete; a hang pinpoints the responsible sequence.
  const cases: Array<[string, Uint8Array | string]> = [
    ["kitty-keyboard query CSI ? u", "\x1b[?u"],
    ["OSC 11 background-color query (expects reply)", "\x1b]11;?\x07"],
    [
      "DECRQM batch (?2026 ?2048 ?2031 ?1010 ?1011)",
      "\x1b[?2026$p\x1b[?2048$p\x1b[?2031$p\x1b[?1010$p\x1b[?1011$p",
    ],
    ["XTWINOPS push window title CSI 22 ; 2 t", "\x1b[22;2t"],
    ["clear scrollback CSI 3 J", "\x1b[H\x1b[3J"],
    ["query prefix of the stream (first 256 bytes)", stream.subarray(0, 256)],
    ["~93KB truecolor SGR burst (stream tail)", stream.subarray(firstTruecolor)],
  ];

  it.each(cases)("completes: %s", async (_name, data) => {
    const term = makeTerminal();
    await writeAll(term, data);
  });
});
