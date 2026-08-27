// Tab close confirmation — the × expands into a red X (no "Close" label,
// tab chrome and width stay). Confirm-only (no Cancel); dismissed by
// clicking anywhere else or Escape. Shift+× and Settings →
// confirmCloseTab=off skip this for session tabs (handled at the call site).
// Settings with unsaved changes also uses this when clicking its ×.
//
// Deliberately NOT ui/confirm.ts: that is a centered modal with Cancel and
// backdrop. Only the × button routes here — Ctrl+W, context-menu Close,
// and session-exited auto-close go straight to TabManager.closeTab.

import { createElement, X } from "lucide";

// Only one tab can be confirming at a time; opening for another replaces it.
let active: { dismiss: () => void } | null = null;

export function dismissTabCloseConfirm(): void {
  active?.dismiss();
}

export function showTabCloseConfirm(
  tabEl: HTMLElement,
  label: string,
  onConfirm: () => void,
): void {
  dismissTabCloseConfirm();

  tabEl.classList.add("confirming");
  tabEl.title = `Close ${label}? · Esc / click away cancels`;

  const float = document.createElement("button");
  float.type = "button";
  float.className = "tab-close-confirm-btn";
  float.appendChild(createElement(X, { stroke: "currentColor", width: 14, height: 14 }));
  float.setAttribute("role", "alertdialog");
  float.setAttribute("aria-label", `Close ${label}?`);

  // Don't let the tab's switchTo / contextmenu handlers see these clicks.
  float.addEventListener("contextmenu", (e) => e.stopPropagation());

  tabEl.appendChild(float);

  const dismiss = (): void => {
    document.removeEventListener("pointerdown", onPointerDown, true);
    document.removeEventListener("keydown", onKeyDown, true);
    mo.disconnect();
    float.remove();
    tabEl.classList.remove("confirming");
    // Restore the hover tooltip to the tab label (badge/label still in DOM).
    const labelEl = tabEl.querySelector(".tab-label");
    tabEl.title = labelEl?.textContent ?? label;
    if (active?.dismiss === dismiss) active = null;
  };

  // Any pointerdown outside the confirming tab cancels. The opening ×
  // click already finished before these listeners attached.
  const onPointerDown = (e: PointerEvent): void => {
    if (!(e.target instanceof Node) || !tabEl.contains(e.target)) dismiss();
  };
  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      dismiss();
    }
  };
  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("keydown", onKeyDown, true);

  // Tab removed by another path (Ctrl+W, session exit, drag detach) → clear.
  const mo = new MutationObserver(() => {
    if (!tabEl.isConnected) dismiss();
  });
  if (tabEl.parentElement) mo.observe(tabEl.parentElement, { childList: true });

  float.addEventListener("click", (e) => {
    e.stopPropagation();
    dismiss();
    onConfirm();
  });
  float.focus();

  active = { dismiss };
}
