// Exclusive chrome popups — tab/terminal context menu, profile ▾, recent-
// folders menu, quick panel. Opening one dismisses the rest: chrome buttons
// stopPropagation and contextmenu ≠ click, so outside-click listeners never
// see the opener and the surfaces would otherwise stack.
//
// Feature modules register their closer at load; they never import each
// other. Palette / tab-switcher call dismissChromePopups() with no except.

export type ChromePopup = "context" | "profile" | "dir" | "quick";

const closers: Partial<Record<ChromePopup, () => void>> = {};

export function registerChromePopup(kind: ChromePopup, close: () => void): void {
  closers[kind] = close;
}

/** Dismiss every chrome popup except `except` (the one about to open). */
export function dismissChromePopups(except?: ChromePopup): void {
  for (const kind of Object.keys(closers) as ChromePopup[]) {
    if (kind !== except) closers[kind]?.();
  }
}
