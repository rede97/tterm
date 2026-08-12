// IME freeze proxy — extracted from TerminalTab._patchImeFreeze. During IME
// composition xterm.js repositions its hidden textarea to the hardware cursor;
// cursor-hiding TUIs park that cursor at line-end, so the OS candidate window
// would land wrong. This wraps `textarea.style` in a Proxy that pins left/top
// to the filtered anchor and clamps width/height/lineHeight to a full cell —
// a 1px textarea kills real TSF compositions (see docs/ime-composition.md).

import type { Terminal } from "@xterm/xterm";
import { imeAnchorCell } from "./imeanchor";
import { getImeDebugFlags } from "./imebox";
import type { CursorPositionFilter } from "./imefilter";
import { cellDimensions, terminalTextarea } from "./xterm-internals";

export interface FreezeHandle {
  dispose(): void;
}

export function patchImeFreeze(
  terminal: Terminal,
  element: HTMLElement,
  filter: CursorPositionFilter,
): FreezeHandle {
  let left: number | null = null;
  let top: number | null = null;
  let refreshTimer: number | null = null;

  // xterm.open() runs synchronously before this is called, so the textarea
  // already exists; if not, there is nothing to freeze.
  const ta = terminalTextarea(terminal);
  if (!ta) return { dispose() {} };

  // Filtered cursor position in pixels, relative to the terminal element.
  // Right edge clamped into a safe area: if the frozen textarea sits at the
  // window's right edge (where cursor-hiding TUIs like btop park the fake
  // cursor), the OS candidate window overflows sideways — and Chromium's IME
  // avoidance mechanism shifts the whole frame to make room for it
  // (compositor-level, not a DOM scroll, so clip can't block it). Keeping the
  // caret clear of the right edge removes the trigger.
  //
  // The BOTTOM edge is deliberately NOT clamped: the candidate window is a
  // top-level OS window and can draw below the app window. Clamping it upward
  // placed it right on top of the floating composition mirror whenever the
  // cursor sat on the bottom row.
  const SAFE_RIGHT = 220; // typical single-row candidate window width
  const pxPos = (): { x: number; y: number } | null => {
    const cellDims = cellDimensions(terminal);
    if (!cellDims) return null;
    const cell = imeAnchorCell(terminal, filter);
    const maxX = Math.max(0, element.clientWidth - cellDims.width - SAFE_RIGHT);
    const maxY = Math.max(0, element.clientHeight - cellDims.height);
    return {
      x: Math.min(cell.x * cellDims.width, maxX),
      y: Math.min(cell.y * cellDims.height, maxY),
    };
  };

  // Replace `ta.style` with a Proxy whose setters for left/top/width are
  // clamped during IME composition.
  const origStyle = ta.style;
  const proxyHandler: ProxyHandler<CSSStyleDeclaration> = {
    set(target, prop, value, receiver) {
      if (left !== null && top !== null) {
        if (prop === "left") {
          return Reflect.set(target, prop, `${left}px`, receiver);
        }
        if (prop === "top") {
          return Reflect.set(target, prop, `${top}px`, receiver);
        }
        // Prevent xterm.js from setting width to a huge value (screen width).
        // Clamp to one cell width so IME candidate window stays at correct position.
        if (prop === "width") {
          const cellW = cellDimensions(terminal)?.width ?? 8;
          return Reflect.set(target, prop, `${Math.max(cellW, 1)}px`, receiver);
        }
        // With the composition-view suppressed (display:none), xterm measures
        // its bounds as 0 and would shrink the textarea to 1px x 1px —
        // xterm's own comment warns "certain IMEs may break" below 1x1.
        // Keep the textarea a full cell so the TSF composition stays alive.
        if (prop === "height" || prop === "lineHeight") {
          const cellH = cellDimensions(terminal)?.height ?? 16;
          return Reflect.set(target, prop, `${Math.max(cellH, 1)}px`, receiver);
        }
      }
      return Reflect.set(target, prop, value, receiver);
    },
  };

  // Override the textarea's style property descriptor so that every
  // `this._textarea.style.left = ...` call in xterm.js goes through our proxy.
  Object.defineProperty(ta, "style", {
    get() {
      return new Proxy(origStyle, proxyHandler);
    },
    set(_v: CSSStyleDeclaration) {
      /* ignore */
    },
    configurable: true,
  });

  const stopRefresh = () => {
    if (refreshTimer !== null) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
  };

  // compositionstart/end: capture the frozen anchor position. These fire on
  // the hidden textarea and bubble through document. dispose() removes them —
  // an anonymous listener would leak the whole tab via its closure.
  const onCompStart = (e: CompositionEvent) => {
    if (e.target !== ta) return; // only this tab's textarea
    const p = pxPos();
    if (p) {
      left = p.x;
      top = p.y;
    }
    // Periodically re-anchor from the filter while composing. Writes go to
    // origStyle directly, bypassing the freeze Proxy.
    stopRefresh();
    if (getImeDebugFlags().reanchor) {
      refreshTimer = window.setInterval(() => {
        const q = pxPos();
        if (!q || (q.x === left && q.y === top)) return;
        left = q.x;
        top = q.y;
        origStyle.left = `${q.x}px`;
        origStyle.top = `${q.y}px`;
      }, 200);
    }
  };

  const onCompEnd = (e: CompositionEvent) => {
    if (e.target !== ta) return;
    left = null;
    top = null;
    stopRefresh();
    // Reset horizontal scroll drift: in cursor-hidden TUI apps (htop/btop)
    // the cursor is parked at a fixed position, often the end of a line. IME
    // composition positions the textarea there, which can trigger xterm.js to
    // scroll the viewport right. On compositionend the scroll should reset,
    // but cursor-hidden mode + the frozen-textarea Proxy can prevent xterm.js's
    // own reset from firing — leaving scrollLeft > 0 and clipping the leftmost
    // column.
    const vp = element.querySelector(".xterm-viewport") as HTMLElement | null;
    if (vp && vp.scrollLeft !== 0) vp.scrollLeft = 0;
  };

  document.addEventListener("compositionstart", onCompStart, true);
  document.addEventListener("compositionend", onCompEnd, true);

  return {
    dispose() {
      stopRefresh();
      document.removeEventListener("compositionstart", onCompStart, true);
      document.removeEventListener("compositionend", onCompEnd, true);
    },
  };
}
