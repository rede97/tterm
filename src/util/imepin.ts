// Fixed IME corner. When Settings → Fixed input box is on, the composition
// mirror and the hidden textarea (which places the OS candidate window) sit
// at the bottom-left of the terminal. Cursor / fake-caret inference is not
// consulted.

import { configStore } from "../core/store";

/** Gap between the pinned caret and the window edges, in CSS pixels. */
export const IME_PIN_PAD = 8;

export function isImePinned(): boolean {
  return configStore.get("imePinCorner");
}

/**
 * Bottom-left of the terminal element. Null only when the element itself
 * has no size (hidden tab, layout churn) — callers skip the write instead
 * of pinning to (0,0). Missing cell metrics fall back to a nominal cell so
 * the corner is still used.
 */
export function imePinnedOrigin(
  clientWidth: number,
  clientHeight: number,
  cellWidth: number,
  cellHeight: number,
): { x: number; y: number; cellH: number } | null {
  if (clientWidth <= 0 || clientHeight <= 0) return null;
  const cellW = cellWidth > 0 ? cellWidth : 8;
  const cellH = cellHeight > 0 ? cellHeight : 16;
  const x = Math.min(IME_PIN_PAD, Math.max(0, clientWidth - cellW));
  const y = Math.max(0, clientHeight - cellH - IME_PIN_PAD);
  return { x, y, cellH };
}
