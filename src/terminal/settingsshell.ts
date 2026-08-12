// Settings page shell — the settings pseudo-tab's lifecycle.
//
// Settings is NOT a real tab: it has no session and lives outside the
// manager's `tabs` Map (tracked as `#settings` in the strip). Opening hides
// every terminal tab and appends the lazily-built page; there are two close
// flavors:
//   close(false)  suspend — page removed, strip tab kept (switching to a
//                 terminal tab does this; clicking the strip tab reopens)
//   close(true)   dismiss — strip tab removed, active terminal tab (or the
//                 welcome screen) restored
// Extracted from TabManager; the manager feeds it hooks for the tab/view
// side effects and keeps a `settingsOpen` getter for the rest of the app.

import { el } from "../ui/dom";
import { closeQuickPanel, updateQuickButton } from "./quickpanel";

export interface SettingsShellHooks {
  // Hide every terminal tab (the #welcome backdrop needs no handling — it
  // stays behind everything via z-index and reappears on its own).
  hideActiveView(): void;
  // Re-show the active terminal tab (fit if dirty); with no tabs left there
  // is nothing to restore — the welcome backdrop is already visible.
  restoreActiveView(): void;
  // Strip layout changed (settings tab added/removed) — re-sync overflow.
  syncStrip(): void;
}

export class SettingsShell {
  open = false;

  private pageEl: HTMLElement | null = null;
  private tabEl: HTMLElement | null = null;
  private factory: (() => Promise<HTMLElement>) | null = null;

  constructor(
    private readonly tabsContainer: HTMLElement,
    private readonly terminalContainer: HTMLElement,
    private readonly hooks: SettingsShellHooks,
  ) {}

  setFactory(fn: () => Promise<HTMLElement>): void {
    this.factory = fn;
  }

  toggle(): void {
    if (this.open) return;
    void this.openSettings();
  }

  private async openSettings(): Promise<void> {
    if (this.pageEl || !this.factory) return;

    this.open = true;
    closeQuickPanel();
    updateQuickButton();

    this.hooks.hideActiveView();

    if (!this.tabEl) {
      this.tabEl = el("div", "tab");
      this.tabEl.dataset.tabId = "#settings";
      this.tabEl.appendChild(el("span", "tab-label", "Settings"));
      const closeBtn = el("button", "tab-close", "×");
      closeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.close(true);
      });
      this.tabEl.appendChild(closeBtn);
      this.tabEl.addEventListener("click", () => this.toggle());
      this.tabsContainer.insertBefore(this.tabEl, this.tabsContainer.firstChild);
      this.hooks.syncStrip();
    }
    this.tabEl.classList.add("active");
    const sCloseBtn = this.tabEl.querySelector(".tab-close") as HTMLElement;
    if (sCloseBtn) sCloseBtn.style.opacity = "1";

    const page = await this.factory();
    // The factory is a dynamic import — genuinely async. If the user
    // closed settings (or switched to a tab) while it was in flight,
    // discard the page: appending it now would stick it on screen with
    // no live settings tab to dismiss it.
    if (!this.open) return;
    this.pageEl = page;
    this.terminalContainer.appendChild(this.pageEl);
  }

  close(restore = true): void {
    if (this.pageEl) {
      this.pageEl.remove();
      this.pageEl = null;
    }
    if (this.tabEl) {
      if (restore) {
        this.tabEl.remove();
        this.tabEl = null;
        this.hooks.syncStrip();
      } else {
        this.tabEl.classList.remove("active");
        const sCloseBtn = this.tabEl.querySelector(".tab-close") as HTMLElement;
        if (sCloseBtn) sCloseBtn.style.opacity = "";
      }
    }

    this.open = false;
    updateQuickButton();

    if (restore) this.hooks.restoreActiveView();
  }
}
