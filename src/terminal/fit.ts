// Grid fit computation — extracted from TerminalTab. Pure: reads DOM metrics
// and the terminal's current grid, returns the target cols/rows without
// mutating anything. The caller applies the resize and its side effects
// (scroll clamp, size hint); the terminal's onResize handler ships the new
// size to the backend.

import type { Terminal } from "@xterm/xterm";
import { hysteresis } from "../util/hysteresis";
import { cellDimensions } from "../util/xterm-internals";

/**
 * Target cols/rows that fit the current container, or null when the grid
 * cannot be measured yet (no cell metrics / detached element / unopened
 * terminal).
 */
export function computeGrid(
  terminal: Terminal,
  container: HTMLElement,
): { cols: number; rows: number } | null {
  const dims = cellDimensions(terminal);
  if (!dims) return null;
  const charWidth = dims.width;
  const charHeight = dims.height;

  const parent = container.parentElement;
  if (!parent) return null;
  const ps = getComputedStyle(parent);
  const parentH = parseFloat(ps.height);
  const parentW = parseFloat(ps.width);

  const termEl = terminal.element;
  if (!termEl) return null;
  const xs = getComputedStyle(termEl);
  let padH = parseFloat(xs.paddingLeft) + parseFloat(xs.paddingRight);
  // xterm-screen padding-right = scrollbar safe area
  const scr = terminal.element?.querySelector(".xterm-screen");
  if (scr) padH += parseFloat(getComputedStyle(scr).paddingRight) || 0;
  const padV = parseFloat(xs.paddingTop) + parseFloat(xs.paddingBottom);

  const floatCols = (parentW - padH) / charWidth;
  const floatRows = (parentH - padV) / charHeight;

  return {
    cols: hysteresis(floatCols, terminal.cols, 0.8, 0.9),
    rows: hysteresis(floatRows, terminal.rows, 0.98, 1.0),
  };
}
