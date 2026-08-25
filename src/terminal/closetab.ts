// Tab close confirmation — a low strip anchored directly under the tab
// whose × was clicked. Design (docs/tabbar-preview.html): confirm-only
// (no Cancel button), dismissed by clicking anywhere else or Escape, no
// drop shadow; Shift+× skips it entirely (handled at the call site).
//
// Deliberately NOT ui/confirm.ts: that is a centered modal with Cancel and
// backdrop, used for destructive config actions. The tab strip is a
// lightweight, spatially-anchored prompt. Only the × button routes here —
// Ctrl+W, context-menu Close, and session-exited auto-close go straight to
// TabManager.closeTab.

// Only one strip exists at a time; opening for another tab replaces it.
let active: { dismiss: () => void } | null = null;

export function dismissTabCloseConfirm(): void {
  active?.dismiss();
}

export function showTabCloseConfirm(
  anchor: HTMLElement,
  label: string,
  onConfirm: () => void,
): void {
  dismissTabCloseConfirm();

  const rect = anchor.getBoundingClientRect();
  const el = document.createElement("div");
  el.className = "tab-close-confirm";
  el.setAttribute("role", "alertdialog");
  el.setAttribute("aria-label", `Close ${label}?`);

  const text = document.createElement("span");
  text.className = "tab-close-confirm-text";
  text.textContent = `Close ${label}?`;
  el.appendChild(text);

  const confirmBtn = document.createElement("button");
  confirmBtn.type = "button";
  confirmBtn.className = "tab-close-confirm-btn";
  confirmBtn.textContent = "Close";
  el.appendChild(confirmBtn);

  // Anchor directly under the tab, clamped inside the viewport.
  document.body.appendChild(el);
  const width = el.offsetWidth;
  const left = Math.max(4, Math.min(rect.left, window.innerWidth - width - 4));
  el.style.left = `${left}px`;
  el.style.top = `${rect.bottom + 2}px`;

  const dismiss = (): void => {
    document.removeEventListener("pointerdown", onPointerDown, true);
    document.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("resize", dismiss);
    strip?.removeEventListener("scroll", dismiss);
    mo.disconnect();
    el.remove();
    if (active?.dismiss === dismiss) active = null;
  };

  // Any pointerdown outside the strip cancels (capture: fires even when the
  // target stops propagation). The opening × click is safe — its pointerdown
  // already happened before these listeners attached.
  const onPointerDown = (e: PointerEvent): void => {
    if (!(e.target instanceof Node) || !el.contains(e.target)) dismiss();
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

  // The strip's position is a snapshot: any layout shift (window resize,
  // strip scroll) or the tab going away (closed by another path, drag
  // reorder detaching the node) invalidates it → dismiss.
  window.addEventListener("resize", dismiss);
  const strip = anchor.closest("#tabs");
  strip?.addEventListener("scroll", dismiss, { passive: true });
  const mo = new MutationObserver(() => {
    if (!anchor.isConnected) dismiss();
  });
  if (anchor.parentElement) mo.observe(anchor.parentElement, { childList: true });

  confirmBtn.addEventListener("click", () => {
    dismiss();
    onConfirm();
  });
  confirmBtn.focus();

  active = { dismiss };
}
