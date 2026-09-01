// IME anchor computation — extracted from TerminalTab so the fake-cursor
// scan (cursor-hiding TUIs: pi, Cursor agent, Claude Code, …) is
// unit-testable in isolation. Pure: reads the xterm buffer + cell metrics,
// mutates nothing.
//
// Agent TUIs hide the hardware cursor (`\x1b[?25l`) and draw their own as a
// 1–2 cell inverse-video caret (`\x1b[7m` / Ink `chalk.inverse`). They park
// the real cursor at line-end after painting, so buffer.cursorX/Y is the
// wrong IME spot. Windows 10 ConPTY often swallows DECTCEM on the primary
// buffer, so xterm still reports the cursor as *visible* — the old scan
// bailed out and the OS candidate window followed the parked end-of-line
// caret. A unique short fake-caret run is therefore used even when the
// hardware cursor looks visible. Older ConPTY may also bake SGR 7 into
// swapped explicit colors (`isInverse()` false); those show up as an
// isolated cell with both fg and bg set.

import type { IBufferCell, Terminal } from "@xterm/xterm";
import type { CursorPositionFilter } from "./imefilter";
import { cellDimensions, cursorIsHidden } from "./xterm-internals";

const SHORT_RUN = 2; // 1 cell, or a CJK wide-caret pair

interface CellSnap {
  inverse: boolean;
  fg: string;
  bg: string;
  width: number;
}

export interface CellPos {
  x: number;
  y: number;
}

export type ImeAnchorWhy = "unique-short-run" | "hidden-nearest-fake" | "fallback";

/** When `scanWhenVisible` is false (Win11 / probe says hide is forwarded),
 *  unique short fake-carets are ignored unless the hardware cursor is hidden. */
export interface ImeAnchorPolicy {
  scanEnabled: boolean;
  scanWhenVisible: boolean;
}

export const DEFAULT_IME_POLICY: ImeAnchorPolicy = {
  scanEnabled: true,
  scanWhenVisible: true,
};

export interface ImeAnchorDump {
  cursorHidden: boolean;
  hardware: CellPos;
  fallback: CellPos;
  fakeCells: CellPos[];
  shortRuns: Array<CellPos & { len: number }>;
  anchor: CellPos;
  why: ImeAnchorWhy;
  policy: ImeAnchorPolicy;
}

function colorKey(mode: number, color: number): string {
  return mode === 0 ? "def" : `${mode}:${color}`;
}

function snapLine(line: { length: number; getCell: IBufferLineGetCell }): CellSnap[] {
  const out: CellSnap[] = [];
  let cell: IBufferCell | undefined;
  for (let x = 0; x < line.length; x++) {
    cell = line.getCell(x, cell);
    if (!cell) break;
    out.push({
      inverse: !!cell.isInverse(),
      fg: colorKey(cell.getFgColorMode(), cell.getFgColor()),
      bg: colorKey(cell.getBgColorMode(), cell.getBgColor()),
      width: cell.getWidth(),
    });
  }
  return out;
}

type IBufferLineGetCell = (x: number, cell?: IBufferCell) => IBufferCell | undefined;

function isIsolatedPainted(row: CellSnap[], x: number): boolean {
  const c = row[x];
  // ConPTY-baked reverse: both planes explicit, unlike a colored glyph
  // (fg only) or a chip (same bg across several cells).
  if (c.width === 0 || c.bg === "def" || c.fg === "def") return false;
  const left = x > 0 ? row[x - 1].bg : "def";
  const rightX = x + Math.max(c.width, 1);
  const right = rightX < row.length ? row[rightX].bg : "def";
  return c.bg !== left && c.bg !== right;
}

function collectFakeCells(rows: CellSnap[][]): CellPos[] {
  const found: CellPos[] = [];
  for (let y = 0; y < rows.length; y++) {
    const row = rows[y];
    for (let x = 0; x < row.length; x++) {
      if (row[x].width === 0) continue;
      if (row[x].inverse || isIsolatedPainted(row, x)) found.push({ x, y });
    }
  }
  return found;
}

function clusterRuns(cells: CellPos[]): Array<CellPos & { len: number }> {
  const runs: Array<CellPos & { len: number }> = [];
  for (const c of cells) {
    const prev = runs[runs.length - 1];
    if (prev && prev.y === c.y && c.x <= prev.x + prev.len) {
      prev.len = c.x - prev.x + 1;
      continue;
    }
    runs.push({ x: c.x, y: c.y, len: 1 });
  }
  return runs;
}

function nearest(candidates: CellPos[], ref: CellPos): CellPos {
  let best = candidates[0];
  let bestD = Number.POSITIVE_INFINITY;
  const refKey = ref.y * 10000 + ref.x;
  for (const c of candidates) {
    const d = Math.abs(c.y * 10000 + c.x - refKey);
    if (d < bestD) {
      best = c;
      bestD = d;
    }
  }
  return best;
}

function snapViewport(terminal: Terminal): CellSnap[][] {
  const buf = terminal.buffer.active;
  const rows: CellSnap[][] = [];
  for (let y = 0; y < terminal.rows; y++) {
    const line = buf.getLine(buf.viewportY + y);
    rows.push(line ? snapLine(line) : []);
  }
  return rows;
}

function pickAnchor(
  terminal: Terminal,
  filter: CursorPositionFilter,
  hidden: boolean,
  policy: ImeAnchorPolicy,
): {
  anchor: CellPos;
  why: ImeAnchorWhy;
  fakeCells: CellPos[];
  shortRuns: Array<CellPos & { len: number }>;
} {
  const buf = terminal.buffer.active;
  const hardware = { x: buf.cursorX, y: buf.cursorY };
  const fallback = filter.position() ?? hardware;
  if (!policy.scanEnabled || (!hidden && !policy.scanWhenVisible)) {
    return { anchor: fallback, why: "fallback", fakeCells: [], shortRuns: [] };
  }
  const fakeCells = collectFakeCells(snapViewport(terminal));
  const runs = clusterRuns(fakeCells);
  const shortRuns = runs.filter((r) => r.len <= SHORT_RUN);

  if (shortRuns.length === 1) {
    const r = shortRuns[0];
    return { anchor: { x: r.x, y: r.y }, why: "unique-short-run", fakeCells, shortRuns };
  }
  if (hidden && fakeCells.length > 0) {
    return {
      anchor: nearest(fakeCells, hardware),
      why: "hidden-nearest-fake",
      fakeCells,
      shortRuns,
    };
  }
  return { anchor: fallback, why: "fallback", fakeCells, shortRuns };
}

/**
 * Anchor cell for the IME candidate window, viewport-relative.
 * `cursorHidden` is overridable so unit tests do not need xterm internals.
 */
export function imeAnchorCell(
  terminal: Terminal,
  filter: CursorPositionFilter,
  cursorHidden = cursorIsHidden(terminal),
  policy = DEFAULT_IME_POLICY,
): CellPos {
  try {
    return pickAnchor(terminal, filter, cursorHidden, policy).anchor;
  } catch {
    const buf = terminal.buffer.active;
    return filter.position() ?? { x: buf.cursorX, y: buf.cursorY };
  }
}

/** Dev/e2e dump of the fake-cursor scan (why the IME landed where it did). */
export function describeImeAnchor(
  terminal: Terminal,
  filter: CursorPositionFilter,
  cursorHidden = cursorIsHidden(terminal),
  policy = DEFAULT_IME_POLICY,
): ImeAnchorDump {
  const buf = terminal.buffer.active;
  const hardware = { x: buf.cursorX, y: buf.cursorY };
  const fallback = filter.position() ?? hardware;
  try {
    const picked = pickAnchor(terminal, filter, cursorHidden, policy);
    return {
      cursorHidden,
      hardware,
      fallback,
      fakeCells: picked.fakeCells,
      shortRuns: picked.shortRuns,
      anchor: picked.anchor,
      why: picked.why,
      policy,
    };
  } catch {
    return {
      cursorHidden,
      hardware,
      fallback,
      fakeCells: [],
      shortRuns: [],
      anchor: fallback,
      why: "fallback",
      policy,
    };
  }
}

/**
 * Filtered cursor position in pixels, relative to the terminal element.
 * Returns a safe fallback when cell metrics are not yet available.
 */
export function cursorPixelPos(
  terminal: Terminal,
  filter: CursorPositionFilter,
  cursorHidden = cursorIsHidden(terminal),
  policy = DEFAULT_IME_POLICY,
): { x: number; y: number; cellH: number } {
  try {
    const dims = cellDimensions(terminal);
    if (!dims) throw new Error("no cell metrics");
    const cell = imeAnchorCell(terminal, filter, cursorHidden, policy);
    return { x: cell.x * dims.width, y: cell.y * dims.height, cellH: dims.height };
  } catch {
    return { x: 8, y: 8, cellH: 16 };
  }
}
