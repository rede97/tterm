// Exclusive chrome popups — tab/terminal context menu, profile ▾, recent-
// folders menu, quick panel, command palette, tab switcher (Ctrl+P / Ctrl+Tab).
// Opening one dismisses the rest: chrome buttons stopPropagation and
// contextmenu ≠ click, so outside-click listeners never see the opener.
//
// Feature modules register their closer at load; they never import each other.

export type ChromePopup = "context" | "profile" | "dir" | "quick" | "palette" | "switcher";

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
