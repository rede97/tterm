// IME anchor computation — extracted from TerminalTab so the inverse-cell
// scan (fake-cursor detection for cursor-hiding TUIs) is unit-testable in
// isolation. Pure: reads the xterm buffer + cell metrics, mutates nothing.

import type { IBufferCell, Terminal } from "@xterm/xterm";
import type { CursorPositionFilter } from "./imefilter";
import { cellDimensions, cursorIsHidden } from "./xterm-internals";

/**
 * Anchor cell for the IME candidate window, viewport-relative.
 * Some TUIs (e.g. pi) hide the hardware cursor (`\x1b[?25l`) and draw their
 * own as an inverse-video cell. In that case buffer.cursorX/Y is wherever the
 * app parked the cursor (often line end), so scan the viewport for the
 * rendered cursor instead. Falls back to the stable-run filter position.
 */
export function imeAnchorCell(
  terminal: Terminal,
  filter: CursorPositionFilter,
): { x: number; y: number } {
  const buf = terminal.buffer.active;
  const fallback = filter.position() ?? { x: buf.cursorX, y: buf.cursorY };
  try {
    if (!cursorIsHidden(terminal)) return fallback;
    let best: { x: number; y: number; d: number } | null = null;
    const ref = buf.cursorY * 10000 + buf.cursorX; // prefer cell nearest the parked cursor
    for (let y = 0; y < terminal.rows; y++) {
      const line = buf.getLine(buf.viewportY + y);
      if (!line) continue;
      let cell: IBufferCell | undefined;
      for (let x = 0; x < line.length; x++) {
        cell = line.getCell(x, cell);
        if (!cell) break;
        if (cell.isInverse()) {
          const d = Math.abs(y * 10000 + x - ref);
          if (!best || d < best.d) best = { x, y, d };
        }
      }
    }
    return best ? { x: best.x, y: best.y } : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Filtered cursor position in pixels, relative to the terminal element.
 * Returns a safe fallback when cell metrics are not yet available.
 */
export function cursorPixelPos(
  terminal: Terminal,
  filter: CursorPositionFilter,
): { x: number; y: number; cellH: number } {
  try {
    const dims = cellDimensions(terminal);
    if (!dims) throw new Error("no cell metrics");
    const cell = imeAnchorCell(terminal, filter);
    return { x: cell.x * dims.width, y: cell.y * dims.height, cellH: dims.height };
  } catch {
    return { x: 8, y: 8, cellH: 16 };
  }
}
