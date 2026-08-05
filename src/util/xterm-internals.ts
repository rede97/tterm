// Narrow typed accessors for the xterm.js internals we rely on. The public
// API exposes none of these; centralizing means an xterm upgrade breaks
// HERE (one file) instead of scattering `as any` across the codebase.

import type { Terminal } from "@xterm/xterm";

interface XtermInternals {
  coreService?: { isCursorHidden?: boolean };
  _renderService?: {
    dimensions: { css: { cell: { width: number; height: number } } };
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
