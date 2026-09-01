import type { Terminal } from "@xterm/xterm";
import { describe, expect, it } from "vitest";
import { describeImeAnchor, imeAnchorCell } from "../src/util/imeanchor";
import type { CursorPositionFilter } from "../src/util/imefilter";

interface CellInit {
  inverse?: boolean;
  fgMode?: number;
  bgMode?: number;
  fg?: number;
  bg?: number;
  width?: number;
}

function cell(init: CellInit = {}) {
  return {
    isInverse: () => !!init.inverse,
    getFgColorMode: () => init.fgMode ?? 0,
    getBgColorMode: () => init.bgMode ?? 0,
    getFgColor: () => init.fg ?? 0,
    getBgColor: () => init.bg ?? 0,
    getWidth: () => init.width ?? 1,
  };
}

function makeTerm(opts: {
  rows: number;
  cols: number;
  cursorX: number;
  cursorY: number;
  overlay?: Array<{ x: number; y: number } & CellInit>;
}): Terminal {
  const grid: CellInit[][] = Array.from({ length: opts.rows }, () =>
    Array.from({ length: opts.cols }, () => ({})),
  );
  for (const o of opts.overlay ?? []) {
    if (o.y >= 0 && o.y < opts.rows && o.x >= 0 && o.x < opts.cols) {
      grid[o.y][o.x] = o;
    }
  }
  return {
    rows: opts.rows,
    buffer: {
      active: {
        cursorX: opts.cursorX,
        cursorY: opts.cursorY,
        viewportY: 0,
        getLine(y: number) {
          const row = grid[y];
          if (!row) return undefined;
          return {
            length: row.length,
            getCell(x: number) {
              return cell(row[x] ?? {});
            },
          };
        },
      },
    },
  } as unknown as Terminal;
}

function filterAt(x: number, y: number): CursorPositionFilter {
  return { position: () => ({ x, y }) } as CursorPositionFilter;
}

describe("imeAnchorCell", () => {
  it("uses the unique inverse caret even when the hardware cursor looks visible", () => {
    // Win10 ConPTY: DECTCEM not forwarded on the primary buffer, so xterm
    // reports the cursor visible — parked at the padded line end after the
    // TUI (pi / Cursor agent / Ink) paints. The fake caret is still SGR 7.
    const term = makeTerm({
      rows: 8,
      cols: 40,
      cursorX: 39,
      cursorY: 4,
      overlay: [{ x: 8, y: 4, inverse: true }],
    });
    expect(imeAnchorCell(term, filterAt(39, 4), false)).toEqual({ x: 8, y: 4 });
  });

  it("keeps a normal shell on the hardware cursor when nothing is inverse", () => {
    const term = makeTerm({ rows: 8, cols: 40, cursorX: 10, cursorY: 5 });
    expect(imeAnchorCell(term, filterAt(10, 5), false)).toEqual({ x: 10, y: 5 });
  });

  it("finds the inverse fake caret when the hardware cursor is hidden and parked far away", () => {
    const term = makeTerm({
      rows: 20,
      cols: 80,
      cursorX: 0,
      cursorY: 19,
      overlay: [{ x: 39, y: 9, inverse: true }],
    });
    expect(imeAnchorCell(term, filterAt(0, 19), true)).toEqual({ x: 39, y: 9 });
  });

  it("does not steal a visible cursor from a long inverse selection", () => {
    const overlay = Array.from({ length: 20 }, (_, x) => ({ x, y: 3, inverse: true }));
    const term = makeTerm({
      rows: 8,
      cols: 40,
      cursorX: 5,
      cursorY: 6,
      overlay,
    });
    expect(imeAnchorCell(term, filterAt(5, 6), false)).toEqual({ x: 5, y: 6 });
  });

  it("treats a ConPTY-baked reverse cell (no inverse flag) as the fake caret", () => {
    const term = makeTerm({
      rows: 6,
      cols: 30,
      cursorX: 29,
      cursorY: 2,
      overlay: [{ x: 4, y: 2, fgMode: 1, bgMode: 1, fg: 0, bg: 7 }],
    });
    expect(imeAnchorCell(term, filterAt(29, 2), false)).toEqual({ x: 4, y: 2 });
  });

  it("ignores a colored glyph that only sets foreground", () => {
    const term = makeTerm({
      rows: 6,
      cols: 30,
      cursorX: 12,
      cursorY: 1,
      overlay: [{ x: 0, y: 1, fgMode: 1, fg: 4 }],
    });
    expect(imeAnchorCell(term, filterAt(12, 1), false)).toEqual({ x: 12, y: 1 });
  });
});

describe("describeImeAnchor", () => {
  it("reports unique-short-run when a single inverse caret is present", () => {
    const term = makeTerm({
      rows: 4,
      cols: 20,
      cursorX: 19,
      cursorY: 3,
      overlay: [{ x: 2, y: 3, inverse: true }],
    });
    const dump = describeImeAnchor(term, filterAt(19, 3), false);
    expect(dump.why).toBe("unique-short-run");
    expect(dump.cursorHidden).toBe(false);
    expect(dump.anchor).toEqual({ x: 2, y: 3 });
    expect(dump.hardware).toEqual({ x: 19, y: 3 });
    expect(dump.policy.scanWhenVisible).toBe(true);
  });

  it("ignores a unique inverse caret when the hardware cursor is visible on modern ConPTY", () => {
    const term = makeTerm({
      rows: 8,
      cols: 40,
      cursorX: 39,
      cursorY: 4,
      overlay: [{ x: 8, y: 4, inverse: true }],
    });
    const modern = { scanEnabled: true, scanWhenVisible: false };
    expect(imeAnchorCell(term, filterAt(39, 4), false, modern)).toEqual({ x: 39, y: 4 });
  });

  it("still finds a hidden fake caret when scanWhenVisible is off", () => {
    const term = makeTerm({
      rows: 20,
      cols: 80,
      cursorX: 0,
      cursorY: 19,
      overlay: [{ x: 39, y: 9, inverse: true }],
    });
    const modern = { scanEnabled: true, scanWhenVisible: false };
    expect(imeAnchorCell(term, filterAt(0, 19), true, modern)).toEqual({ x: 39, y: 9 });
  });

  it("follows the hardware cursor when the settings toggle is off", () => {
    const term = makeTerm({
      rows: 8,
      cols: 40,
      cursorX: 10,
      cursorY: 5,
      overlay: [{ x: 8, y: 4, inverse: true }],
    });
    expect(
      imeAnchorCell(term, filterAt(10, 5), true, { scanEnabled: false, scanWhenVisible: true }),
    ).toEqual({
      x: 10,
      y: 5,
    });
  });
});
