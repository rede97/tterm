// Narrow typed accessors for the xterm.js internals we rely on. The public
// API exposes none of these; centralizing means an xterm upgrade breaks
// HERE (one file) instead of scattering `as any` across the codebase.

import type { Terminal } from "@xterm/xterm";

interface XtermInternals {
  coreService?: { isCursorHidden?: boolean };
  _renderService?: {
    dimensions: { css: { cell: { width: number; height: number } } };
  };
  _bufferService?: {
    buffer?: {
      lines?: {
        onTrim?: (cb: (trimmed: number) => void) => { dispose(): void };
      };
    };
  };
  textarea?: HTMLTextAreaElement;
  screenElement?: HTMLElement;
}

function internals(term: Terminal): XtermInternals {
  // xterm's public typings hide `_core`; the cast lands on a named const
  // because the compiler cannot verify the private shape — XtermInternals
  // documents exactly what we rely on.
  const core: { _core: XtermInternals } = term as unknown as { _core: XtermInternals };
  return core._core;
}

/** Hardware cursor visibility (TUIs hide it and draw their own). */
export function cursorIsHidden(term: Terminal): boolean {
  try {
    return !!internals(term).coreService?.isCursorHidden;
  } catch {
    return false;
  }
}

/** CSS cell metrics; null before the first render pass. */
export function cellDimensions(term: Terminal): { width: number; height: number } | null {
  try {
    return internals(term)._renderService?.dimensions.css.cell ?? null;
  } catch {
    return null;
  }
}

/** xterm's hidden input textarea (IME composition target). */
export function terminalTextarea(term: Terminal): HTMLTextAreaElement | undefined {
  return internals(term).textarea;
}

/** Subscribe to scrollback trims of the ACTIVE buffer's line list (xterm's
 * CircularList.onTrim — the only accurate signal for "N lines dropped off
 * the top"; xterm's own SelectionService uses it). Null when the internal
 * shape is unavailable (xterm upgrade) — callers must degrade to an epoch
 * bump, never to silently wrong line addresses. */
export function onBufferTrim(
  term: Terminal,
  cb: (trimmed: number) => void,
): { dispose(): void } | null {
  try {
    const sub = internals(term)._bufferService?.buffer?.lines?.onTrim?.(cb);
    return sub ?? null;
  } catch {
    return null;
  }
}
