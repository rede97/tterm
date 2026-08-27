// Restore xterm keyboard focus after something else (a modal, palette,
// native window reactivation) stole it. The policy lives in wiring.ts so
// this module never imports TabManager.
//
// Callers: modal stack becoming empty, window focus, palette/switcher close.
// Skip when Settings, Find, rename, or another overlay still owns input.

let _restore: (() => void) | null = null;

export function setTerminalFocusRestore(fn: () => void): void {
  _restore = fn;
}

/** Return typing to the active terminal on the next frame (overlay is gone). */
export function restoreTerminalFocus(): void {
  if (!_restore) return;
  requestAnimationFrame(() => _restore?.());
}

/** Tests. */
export function resetTerminalFocusForTests(): void {
  _restore = null;
}
