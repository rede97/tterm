// Tab close confirmation — replaces the tab's chrome in-place with
// "Confirm:" + a Close button (docs/tabbar-preview.html). Confirm-only
// (no Cancel); dismissed by clicking anywhere else or Escape. Shift+×
// and Settings → confirmCloseTab=off skip this (handled at the call site).
//
// Deliberately NOT ui/confirm.ts: that is a centered modal with Cancel and
// backdrop. Only the × button routes here — Ctrl+W, context-menu Close,
// and session-exited auto-close go straight to TabManager.closeTab.

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

  const inline = document.createElement("div");
  inline.className = "tab-close-confirm-inline";
  inline.setAttribute("role", "alertdialog");
  inline.setAttribute("aria-label", `Close ${label}?`);

  const text = document.createElement("span");
  text.className = "tab-close-confirm-text";
  text.textContent = "Confirm:";
  inline.appendChild(text);

  const confirmBtn = document.createElement("button");
  confirmBtn.type = "button";
  confirmBtn.className = "tab-close-confirm-btn";
  confirmBtn.textContent = "Close";
  inline.appendChild(confirmBtn);

  // Don't let the tab's switchTo / contextmenu handlers see these clicks.
  inline.addEventListener("click", (e) => e.stopPropagation());
  inline.addEventListener("contextmenu", (e) => e.stopPropagation());

  tabEl.appendChild(inline);

  const dismiss = (): void => {
    document.removeEventListener("pointerdown", onPointerDown, true);
    document.removeEventListener("keydown", onKeyDown, true);
    mo.disconnect();
    inline.remove();
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

  confirmBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    dismiss();
    onConfirm();
  });
  confirmBtn.focus();

  active = { dismiss };
}
