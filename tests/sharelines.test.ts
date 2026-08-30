// Absolute line addressing for AI share (/lines endpoint frontend half).
// Covers: trim accounting (trimBase via xterm's internal onTrim), the three
// query forms, epoch invalidation on clear/resize/alt-switch, and stale
// epoch rejection — the contract agents rely on when paging history.
import { Terminal } from "@xterm/xterm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  readShareLines,
  recordShareSeq,
  SHARE_LINES_MAX,
  shareLineState,
} from "../src/terminal/sharelines";

// rows=5, scrollback=10 → buffer caps at 15 lines.
const ROWS = 5;
const SCROLLBACK = 10;

function write(term: Terminal, data: string): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  term.write(data, resolve);
  return promise;
}

function makeTerm(): Terminal {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const term = new Terminal({ rows: ROWS, scrollback: SCROLLBACK, cols: 40 });
  shareLineState(term); // attach tracking (the factory does this in prod)
  term.open(el);
  return term;
}

/** Write lines L<start>..L<start+n-1> (CRLF each); ends with the cursor on
 * a fresh line. */
async function writeNumbered(term: Terminal, n: number, start = 1): Promise<void> {
  let s = "";
  for (let i = start; i < start + n; i++) s += `L${i}\r\n`;
  await write(term, s);
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("share line addressing", () => {
  it("tracks trims so absolute numbers survive scrollback cycling", async () => {
    const term = makeTerm();
    await writeNumbered(term, 30); // 30 lines + cursor line = 31; cap 15
    const st = shareLineState(term);
    expect(st.trimBase).toBe(31 - (ROWS + SCROLLBACK)); // 16
    const r = readShareLines(term, { tail: 5 });
    expect(r.total).toBe(31);
    expect(r.from).toBe(26);
    expect(r.lines).toEqual(["L27", "L28", "L29", "L30", ""]);
  });

  it("before+count pages backwards from an anchor", async () => {
    const term = makeTerm();
    await writeNumbered(term, 30);
    const r = readShareLines(term, { before: 26, count: 5 });
    expect(r.from).toBe(21);
    expect(r.lines).toEqual(["L22", "L23", "L24", "L25", "L26"]);
  });

  it("from+to reads an exact half-open range", async () => {
    const term = makeTerm();
    await writeNumbered(term, 30);
    const r = readShareLines(term, { from: 16, to: 18 });
    expect(r.lines).toEqual(["L17", "L18"]);
    expect(r.count).toBe(2);
  });

  it("clamps reads to what survives; never invents lines", async () => {
    const term = makeTerm();
    await writeNumbered(term, 30);
    // Asking for way more than the buffer holds starts at trimBase, not 0.
    const r = readShareLines(term, { tail: 999 });
    expect(r.from).toBe(16);
    expect(r.count).toBe(15);
  });

  it("rejects a stale epoch with the current one for re-anchoring", async () => {
    const term = makeTerm();
    await writeNumbered(term, 3);
    const ok = readShareLines(term, { tail: 10 });
    expect(ok.epoch).toBe(0);
    const stale = readShareLines(term, { tail: 10, epoch: 7 });
    expect(stale.error).toBe("stale_epoch");
    expect(stale.epoch).toBe(0);
  });

  it("bumps epoch on clear (lines gone without a trim)", async () => {
    const term = makeTerm();
    await writeNumbered(term, 30);
    readShareLines(term, { tail: 1 }); // sample: lastTotal = 31
    term.clear();
    const r = readShareLines(term, { tail: 5 });
    expect(r.epoch).toBe(1);
    expect(r.total).toBeLessThan(31);
  });

  it("bumps epoch on resize (reflow shifts indices)", async () => {
    const term = makeTerm();
    await writeNumbered(term, 10);
    readShareLines(term, { tail: 1 });
    term.resize(60, 8);
    const r = readShareLines(term, { tail: 5 });
    expect(r.epoch).toBe(1);
  });

  it("bumps epoch on alt-screen entry", async () => {
    const term = makeTerm();
    await writeNumbered(term, 3);
    readShareLines(term, { tail: 1 });
    await write(term, "\x1b[?1049h"); // enter alt screen
    const r = readShareLines(term, { tail: 5 });
    expect(r.epoch).toBe(1);
    expect(r.alt_screen).toBe(true);
  });

  it("caps a single read at SHARE_LINES_MAX", async () => {
    const term = makeTerm();
    await writeNumbered(term, 5);
    const r = readShareLines(term, { tail: SHARE_LINES_MAX + 500 });
    expect(r.truncated).toBe(true);
    expect(r.count).toBeLessThanOrEqual(SHARE_LINES_MAX);
  });

  it("rejects malformed ranges", async () => {
    const term = makeTerm();
    await writeNumbered(term, 3);
    expect(readShareLines(term, {}).error).toBe("bad_range");
    expect(readShareLines(term, { before: 5 }).error).toBe("bad_range");
    expect(readShareLines(term, { from: 9, to: 2 }).error).toBe("bad_range");
  });

  it("since returns only lines appended after the client's seq", async () => {
    const term = makeTerm();
    await writeNumbered(term, 5); // L1..L5 at abs 0..4, cursor line at abs 5
    recordShareSeq(term, 10); // render at seq 10 saw 6 buffer lines
    await writeNumbered(term, 3, 6); // L6..L8 at abs 5..7, cursor at abs 8
    recordShareSeq(term, 11);
    const r = readShareLines(term, { since: 10 });
    expect(r.error).toBeUndefined();
    expect(r.from).toBe(6);
    expect(r.lines).toEqual(["L7", "L8", ""]);
    // Already up to date: empty, not an error.
    const caught = readShareLines(term, { since: 11 });
    expect(caught.count).toBe(0);
    expect(caught.lines).toEqual([]);
  });

  it("since after an empty first paint returns first-screen writes", async () => {
    const term = makeTerm();
    // Birth: buffer.length === rows of empty filler. Recording that paint
    // must not jump the append log to total=rows, or writes into those
    // rows are invisible to since=<seq from /screen>.
    expect(term.buffer.active.length).toBe(ROWS);
    recordShareSeq(term, 1);
    await write(term, "AT\r\n\r\n\r\nOK");
    recordShareSeq(term, 2);
    const r = readShareLines(term, { since: 1 });
    expect(r.error).toBeUndefined();
    expect(r.count).toBeGreaterThan(0);
    expect(r.lines).toEqual(expect.arrayContaining(["AT", "OK"]));
  });

  it("since sees later first-screen writes after an earlier filler fill-in", async () => {
    const term = makeTerm();
    recordShareSeq(term, 1);
    await write(term, "AT\r\n");
    recordShareSeq(term, 2);
    await write(term, "\r\n\r\nOK");
    recordShareSeq(term, 3);
    const r = readShareLines(term, { since: 2 });
    expect(r.error).toBeUndefined();
    expect(r.lines).toContain("OK");
  });

  it("since rejects seqs that predate the append log", async () => {
    const term = makeTerm();
    await writeNumbered(term, 3);
    // Attach seed (seq 0) covers everything produced so far (3 content
    // lines + the birth-time empty filler lines below the cursor).
    expect(readShareLines(term, { since: 0 }).count).toBe(5);

    // Fill the scrollback, anchor a seq, then clear: the shrink bumps the
    // epoch and wipes the log, so the pre-clear seq must NOT floor-match
    // into a wrong "nothing new" answer.
    await writeNumbered(term, 30, 4);
    recordShareSeq(term, 5);
    readShareLines(term, { tail: 1 }); // sample lastTotal at full buffer
    term.clear();
    expect(readShareLines(term, { since: 5 }).error).toBe("unknown_seq");
  });
});
