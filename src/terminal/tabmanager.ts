import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { createElement, FolderOpen } from "lucide";
import Sortable from "sortablejs";
import { findSerialProfile } from "../config/serial-profiles";
import { hostProp } from "../core/common";
import { DOM_ID } from "../core/dom-ids";
import { logCatch, swallow } from "../core/errorlog";
import { configStore } from "../core/store";
import { notifyTrayTabs, setTrayTabsProvider } from "../core/traytabs";
import type {
  SerialEnterNewline,
  SerialInputMode,
  SerialOutputNewline,
  SerialPort,
  SshHost,
  TabType,
  WsConnectResult,
} from "../core/types";
import { mustGetById } from "../ui/dom";
import { addForward, type NewForward } from "../ui/forwarding";
import { showToast } from "../ui/toast";
import { closeQuickPanel, closeQuickPanelForTab, updateQuickButton } from "./quickpanel";
import { closeFindForTab } from "./search";
import {
  setSerialBaud,
  setSerialEnterNewline,
  setSerialInputMode,
  setSerialOutputNewline,
  setSerialProfile,
} from "./serialctl";
import { SettingsShell } from "./settingsshell";
import { cancelSshSecretPromptFor, setSshSecretPromptTab } from "./sshauth";
import { TerminalTab } from "./tab";
import {
  clearTab as actionClearTab,
  closeOtherTabs as actionCloseOtherTabs,
  closeTabsRight as actionCloseTabsRight,
  duplicateTab as actionDuplicateTab,
  exportTab as actionExportTab,
  renameTab as actionRenameTab,
  shareTab as actionShareTab,
} from "./tabactions";

/// Toggle the strip's layout-state classes from live metrics:
/// `overflowing` (strip scrolls → +/dropdown pin), `can-scroll-left`
/// (tabs occluded on the left → left edge shadow) and `can-scroll-right`
/// (more tabs off-screen right → right edge shadow).
export function syncTabStripState(el: HTMLElement): void {
  el.classList.toggle("overflowing", el.scrollWidth > el.clientWidth + 1);
  el.classList.toggle("can-scroll-left", el.scrollLeft > 1);
  el.classList.toggle("can-scroll-right", el.scrollWidth - el.clientWidth - el.scrollLeft > 1);
}

export class TabManager {
  tabs = new Map<string, TerminalTab>();
  activeTabId: string | null = null;

  // Most-recently-used tab ids, front = current. Drives the Ctrl+Tab
  // switcher order. Updated on switch, pruned on close.
  private _mru: string[] = [];

  // The settings pseudo-tab's lifecycle lives in SettingsShell (created by
  // initSettingsShell once real containers exist). External readers keep
  // using the `settingsOpen` getter.
  private _settings!: SettingsShell;

  get settingsOpen(): boolean {
    return this._settings?.open ?? false;
  }

  readonly tabsContainer: HTMLElement;
  readonly terminalContainer: HTMLElement;

  private _resizeTimer: ReturnType<typeof setTimeout> | null = null;
  private _nextPendingSsh = 1;

  constructor(
    tabsContainer: HTMLElement | null = null,
    terminalContainer: HTMLElement | null = null,
  ) {
    // The module-level singleton is constructed before the real containers
    // exist (imports run before main.ts wires them via initTabManager's
    // Object.assign). Detached placeholder divs satisfy the non-null field
    // type until injection; they are never appended.
    this.tabsContainer = tabsContainer ?? document.createElement("div");
    this.terminalContainer = terminalContainer ?? document.createElement("div");

    window.addEventListener("resize", () => this._onResize());

    // Backend session state (dead → in-band prompt / respawned): drives the
    // tab-label strikethrough. Reconnect itself is fully backend-managed —
    // the user presses Enter at the prompt printed in the terminal stream.
    // (Guarded: the module-level singleton is also constructed in unit
    // tests, where no Tauri IPC bridge exists.)
    if ("__TAURI_INTERNALS__" in window) {
      listen<{ id: string; alive: boolean }>("session-state", (e) => {
        this.tabs.get(e.payload.id)?.setDisconnected(!e.payload.alive);
        updateQuickButton();
      });
      // PTY child exit (shell quit via Ctrl+D / `exit`, external ssh
      // logout): a deliberate exit closes the tab outright — no dead-mode
      // reconnect prompt. Non-zero exits (crash, ssh network drop) keep
      // the dead-mode prompt so the session can be respawned in place.
      listen<{ id: string; code: number }>("session-exited", (e) => {
        if (e.payload.code === 0 && this.tabs.has(e.payload.id)) {
          this.closeTab(e.payload.id);
        }
      });
      // Tray restore with a picked tab: same-process restores emit this
      // event directly; cross-process restores park a request file that we
      // pick up on focus (below).
      listen<number>("tray-activate-tab", (e) => this.activateTabAt(e.payload));
      getCurrentWindow().onFocusChanged((f) => {
        if (!f.payload) return;
        invoke<number | null>("tray_take_pending_tab")
          .then((idx) => {
            if (typeof idx === "number") this.activateTabAt(idx);
          })
          .catch(swallow);
      });
    }
  }

  // Tab drag reorder via SortableJS (mature pointer math; forceFallback
  // avoids the unreliable native HTML5 drag-and-drop in WebView2).
  // Must be called after the real containers are injected (the module-level
  // singleton is constructed with nulls).
  initSortable(): void {
    // Edge shadows track scrolling itself, not just structural changes
    // (add/close/resize already funnel through _syncTabsOverflow).
    this.tabsContainer.addEventListener("scroll", () => this._syncTabsOverflow(), {
      passive: true,
    });
    new Sortable(this.tabsContainer, {
      animation: 150,
      direction: "horizontal",
      draggable: '.tab[data-tab-id^="tab-"]',
      filter: ".tab-close",
      preventOnFilter: false,
      forceFallback: true,
      fallbackTolerance: 5,
      onEnd: () => {
        this._syncTabOrderFromDom();
        this.refreshBadges();
        // The tray submenu carries positional indices — keep it in sync
        // with the new order or it activates the wrong tab.
        notifyTrayTabs();
      },
    });
  }

  // -- tab creation --

  private _createTabElement(tab: TerminalTab): HTMLElement {
    const el = document.createElement("div");
    el.className = "tab";
    el.dataset.tabId = tab.id;
    // NOTE: no data-tauri-drag-region here — tabs support mouse-based
    // drag reordering, which would conflict with native window dragging.

    const badge = document.createElement("span");
    badge.className = "tab-badge";
    el.appendChild(badge);

    const label = document.createElement("span");
    label.className = "tab-label";
    label.textContent = tab.label;
    el.appendChild(label);

    // Tabs are equal-width now, so names are often truncated: the hover
    // tooltip always carries the full label (kept in sync on rename and
    // OSC title changes).
    el.title = tab.label;

    const closeBtn = document.createElement("button");
    closeBtn.className = "tab-close";
    closeBtn.textContent = "×";
    closeBtn.setAttribute("aria-label", `Close ${tab.label}`);
    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.closeTab(tab.id);
    });
    el.appendChild(closeBtn);

    el.addEventListener("click", () => this.switchTo(tab.id));
    el.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      import("./contextmenu").then((m) => m.showTabContextMenu(tab.id, e.clientX, e.clientY));
    });

    tab.tabElement = el;
    return el;
  }

  // Rebuild the tabs Map in DOM order after a drag reorder.
  private _syncTabOrderFromDom(): void {
    const ordered = new Map<string, TerminalTab>();
    for (const el of this.tabsContainer.querySelectorAll<HTMLElement>(".tab[data-tab-id]")) {
      const id = el.dataset.tabId;
      if (!id || id === "#settings") continue;
      const tab = this.tabs.get(id);
      if (tab) ordered.set(tab.id, tab);
    }
    this.tabs = ordered;
  }

  private _register(tab: TerminalTab, port: number, token: string): void {
    const tabEl = this._createTabElement(tab);
    // Keep the + button group as the last child of #tabs (flush after the
    // last tab).
    this.tabsContainer.insertBefore(tabEl, document.getElementById(DOM_ID.newTabGroup));

    tab.onSocketClosed = () => this._onSessionClosed(tab.id);
    tab.attachSocket(port, token);

    this.tabs.set(tab.id, tab);
  }

  // Session socket closed for good (relay slot torn down). With backend
  // dead-mode this only fires on tab kill, so it is effectively a no-op
  // safety net.
  private _onSessionClosed(tabId: string): void {
    const tab = this.tabs.get(tabId);
    if (!tab || tab.disconnected) return;
    tab.setDisconnected(true);
  }

  // Resolve the user's default local profile (settings → Profiles), falling
  // back to the first known profile. Returns null when no profiles are
  // loaded (backend get_shell() fallback kicks in).
  defaultLocalProfile(): { command: string; name: string } | null {
    const defName =
      configStore.get("defaultLocalProfile") ?? configStore.get("localProfiles")[0]?.name ?? null;
    const p = defName ? configStore.get("localProfiles").find((x) => x.name === defName) : null;
    return p ? { command: p.command, name: p.name } : null;
  }

  async createLocalTab(
    command?: string,
    label?: string,
    cwd?: string,
  ): Promise<TerminalTab | null> {
    let result: WsConnectResult;
    try {
      result = await invoke("pty_spawn", {
        ...(command ? { command } : {}),
        ...(cwd ? { cwd } : {}),
      });
    } catch (e) {
      showToast(`Failed to start shell: ${e}`, "error");
      return null;
    }
    const tab = this._makeTab(result, "local", label || "Terminal");
    if (!tab) return null;
    if (command) {
      tab.command = command;
    }
    return this._finalizeTab(tab, result);
  }

  async createSshTab(host: SshHost): Promise<TerminalTab | null> {
    if (configStore.get("sshEmbedded")) {
      return this._createEmbeddedSshTab(host);
    }
    let result: WsConnectResult;
    try {
      result = await invoke("pty_spawn_ssh", {
        hostname: hostProp(host, "hostname") || host.name,
        port: parseInt(hostProp(host, "port") || "22", 10),
        user: hostProp(host, "user") || "root",
      });
    } catch (e) {
      showToast(`Failed to start SSH session: ${e}`, "error");
      return null;
    }
    const tab = this._makeTab(result, "ssh", host.name);
    if (!tab) return null;
    tab.sshHost = host;
    tab.sshEmbedded = false;
    return this._finalizeTab(tab, result);
  }

  // Built-in client: open the tab first so password/passphrase can be
  // typed in xterm (OpenSSH-style). Host-key confirmation stays a modal.
  private async _createEmbeddedSshTab(host: SshHost): Promise<TerminalTab | null> {
    const target = `${hostProp(host, "user") || "root"}@${hostProp(host, "hostname") || host.name}`;
    const tab = await this._openPendingSshTab(host, target);
    if (!tab) return null;
    setSshSecretPromptTab(tab);
    let result: WsConnectResult;
    try {
      result = await invoke("ssh_spawn_embedded", {
        spec: {
          hostname: hostProp(host, "hostname") || host.name,
          port: parseInt(hostProp(host, "port") || "22", 10),
          user: hostProp(host, "user") || "root",
          identityFile: hostProp(host, "identityfile") || null,
        },
        promptTabId: tab.id,
      });
    } catch (e) {
      cancelSshSecretPromptFor(tab.id);
      if (this.tabs.has(tab.id)) await this.closeTab(tab.id);
      if (!String(e).toLowerCase().includes("cancelled")) {
        showToast(`Failed to start SSH session: ${e}`, "error");
      }
      return null;
    } finally {
      setSshSecretPromptTab(null);
    }
    // Closed while handshake was in flight: the pending id has no backend
    // session; kill the real one that just came back.
    if (!this.tabs.has(tab.id) || this._closing.has(tab.id)) {
      invoke("pty_kill", { id: result.id }).catch(logCatch("session.killOrphan"));
      return null;
    }
    this._bindSshSession(tab, result);
    this._applyConfigForwards(result.id, host);
    return tab;
  }

  private async _openPendingSshTab(host: SshHost, target: string): Promise<TerminalTab | null> {
    const id = `pending-ssh-${this._nextPendingSsh++}`;
    let tab: TerminalTab;
    try {
      tab = new TerminalTab(id, "ssh", host.name, this.terminalContainer);
    } catch (e) {
      showToast(`Failed to start terminal: ${e}`, "error");
      return null;
    }
    tab.sshHost = host;
    tab.sshEmbedded = true;
    const tabEl = this._createTabElement(tab);
    this.tabsContainer.insertBefore(tabEl, document.getElementById(DOM_ID.newTabGroup));
    this.tabs.set(tab.id, tab);
    await this._ensureFontsReady(tab);
    this.switchTo(tab.id);
    tab.fit();
    tab.terminal.write(`Connecting to ${target}…\r\n`);
    this.refreshBadges();
    return tab;
  }

  private _bindSshSession(tab: TerminalTab, result: WsConnectResult): void {
    const oldId = tab.id;
    const newId = result.id;
    if (oldId !== newId) {
      this.tabs.delete(oldId);
      tab.id = newId;
      tab.tabElement.dataset.tabId = newId;
      this.tabs.set(newId, tab);
      if (this.activeTabId === oldId) this.activeTabId = newId;
      this._mru = this._mru.map((x) => (x === oldId ? newId : x));
    }
    tab.onSocketClosed = () => this._onSessionClosed(tab.id);
    tab.attachSocket(result.port, result.token);
    tab.fitDeferred();
    this.refreshBadges();
    notifyTrayTabs();
  }

  // Fire-and-forget: each failure toasts individually (addForward), the
  // session itself is already up and unaffected.
  private _applyConfigForwards(tabId: string, host: SshHost): void {
    const specs: NewForward[] = [];
    const collect = (raw: string | undefined, kind: string): void => {
      if (!raw) return;
      for (const line of raw.split("\n")) {
        // "[listen_host:]port target_host:port" — bare port binds loopback.
        const m = line.trim().match(/^(?:(\S+):)?(\d+)\s+(\S+):(\d+)$/);
        if (!m) continue;
        specs.push({
          kind,
          listenHost: m[1] ?? "127.0.0.1",
          listenPort: parseInt(m[2], 10),
          targetHost: m[3],
          targetPort: parseInt(m[4], 10),
        });
      }
    };
    collect(hostProp(host, "localforward"), "local");
    collect(hostProp(host, "remoteforward"), "remote");
    // DynamicForward carries a single endpoint: [listen_host:]port.
    const dyn = hostProp(host, "dynamicforward");
    if (dyn) {
      for (const line of dyn.split("\n")) {
        const m = line.trim().match(/^(?:(\S+):)?(\d+)$/);
        if (!m) continue;
        specs.push({
          kind: "dynamic",
          listenHost: m[1] ?? "127.0.0.1",
          listenPort: parseInt(m[2], 10),
          targetHost: "",
          targetPort: 0,
        });
      }
    }
    // Sequential: listener binds stay ordered and errors don't interleave.
    (async () => {
      for (const s of specs) await addForward(tabId, s);
    })().catch(logCatch("ssh.configForwards"));
  }

  async createSerialTab(port: SerialPort): Promise<TerminalTab | null> {
    // Session behavior comes from the selected profile; baud from the
    // global default. No per-device parameter memory (removed by design).
    const profile = findSerialProfile(configStore.get("serialProfile"));
    const baud = configStore.get("serialBaud");
    let result: WsConnectResult;
    try {
      result = await invoke("serial_spawn", {
        portName: port.name,
        baudRate: baud,
        dataBits: 8,
        parity: "none",
        stopBits: 1,
        flowControl: profile.flowControl,
        outputNewline: profile.outputNewline,
      });
    } catch (e) {
      showToast(String(e), "error");
      return null;
    }
    const tab = this._makeTab(result, "serial", `${port.name} · ${baud}`);
    if (!tab) return null;
    tab.serialPortName = port.name;
    tab.serialPort = port;
    tab.serialBaud = baud;
    tab.serialProfile = profile.name;
    tab.outputNewline = profile.outputNewline;
    tab.flowControl = profile.flowControl;
    // Setters (not field assignment): the input handler was hooked in the
    // constructor with default mode/terminator and captures both — only the
    // setters re-hook it with the profile's values.
    tab.setSerialInputMode(profile.inputMode);
    tab.setSerialEnterNewline(profile.enterNewline);
    return this._finalizeTab(tab, result);
  }

  // Serial live setters delegate to terminal/serialctl.ts (pure tab+IPC
  // functions, extracted from this class).
  async setSerialProfile(tabId: string, name: string): Promise<void> {
    await setSerialProfile(this.tabs.get(tabId), name);
  }

  async setSerialEnterNewline(tabId: string, mode: SerialEnterNewline): Promise<void> {
    await setSerialEnterNewline(this.tabs.get(tabId), mode);
  }

  setSerialInputMode(tabId: string, mode: SerialInputMode): void {
    setSerialInputMode(this.tabs.get(tabId), mode);
  }

  async setSerialOutputNewline(tabId: string, mode: SerialOutputNewline): Promise<void> {
    await setSerialOutputNewline(this.tabs.get(tabId), mode);
  }

  async setSerialBaud(tabId: string, baud: number): Promise<void> {
    await setSerialBaud(this.tabs.get(tabId), baud);
  }

  async createDemoTab(): Promise<TerminalTab | null> {
    let result: WsConnectResult;
    try {
      result = await invoke("demo_spawn");
    } catch (e) {
      showToast(String(e), "error");
      return null;
    }
    const tab = this._makeTab(result, "local", "Demo TTY");
    if (!tab) return null;
    return this._finalizeTab(tab, result);
  }

  async createAnimeTab(): Promise<TerminalTab | null> {
    let result: WsConnectResult;
    try {
      result = await invoke("anime_spawn");
    } catch (e) {
      showToast(String(e), "error");
      return null;
    }
    const tab = this._makeTab(result, "local", "Anime TTY");
    if (!tab) return null;
    return this._finalizeTab(tab, result);
  }

  // Wrap TerminalTab construction: it loads the WebGL renderer, and a throw
  // there would orphan the already-spawned backend session — kill it.
  private _makeTab(result: WsConnectResult, type: TabType, label: string): TerminalTab | null {
    try {
      return new TerminalTab(result.id, type, label, this.terminalContainer);
    } catch (e) {
      invoke("pty_kill", { id: result.id }).catch(logCatch("session.killOrphan"));
      showToast(`Failed to start terminal: ${e}`, "error");
      return null;
    }
  }

  // Shared tail of every create*Tab: register with the hub, wait out the
  // web-font race, then show + fit.
  private async _finalizeTab(tab: TerminalTab, result: WsConnectResult): Promise<TerminalTab> {
    this._register(tab, result.port, result.token);
    await this._ensureFontsReady(tab);
    this.switchTo(result.id);
    tab.fitDeferred();
    this.refreshBadges();
    return tab;
  }

  // Wait for web fonts to load, then force xterm to re-measure character cells.
  // Without this, the first tab opened measures with a fallback font and caches
  // wrong glyph metrics, causing wide character spacing until next resize.
  private async _ensureFontsReady(tab: TerminalTab): Promise<void> {
    await document.fonts.ready;
    const ff = tab.terminal.options.fontFamily;
    tab.terminal.options.fontFamily = "";
    tab.terminal.options.fontFamily = ff;
  }

  // -- switch / close --

  switchTo(id: string): void {
    const wasSettingsOpen = this.settingsOpen;
    if (wasSettingsOpen) {
      this._settings.close(false);
    }

    if (this.activeTabId === id) {
      if (wasSettingsOpen) {
        const tab = this.tabs.get(id);
        if (tab) tab.show();
      }
      return;
    }

    const prev = this.activeTabId ? this.tabs.get(this.activeTabId) : null;
    const next = this.tabs.get(id);

    if (!next) return;

    if (prev) prev.hide();
    next.show();
    this.activeTabId = id;
    this._mru = [id, ...this._mru.filter((x) => x !== id)];
    // The quick panel tracks the active tab; switching closes it.
    closeQuickPanel();
    updateQuickButton();
    // The tray submenu lists this window's tabs; the title follows the
    // active tab's label.
    notifyTrayTabs();

    if (next.needsResize) {
      // fit() resizes the grid; terminal.onResize ships the size to the backend.
      next.fit();
      next.needsResize = false;
    }
  }

  private _closing = new Set<string>();

  async closeTab(id: string): Promise<void> {
    const tab = this.tabs.get(id);
    // Re-entry guard: a second closeTab(id) while the first awaits
    // pty_kill would run the whole teardown twice (double pty_kill,
    // double terminal.dispose).
    if (!tab || this._closing.has(id)) return;
    this._closing.add(id);
    try {
      cancelSshSecretPromptFor(tab.id);
      if (tab.shared) invoke("share_revoke", { id }).catch(swallow);
      // Pending SSH tabs have no backend session yet. UI close must not
      // depend on the backend ack for live sessions.
      if (!id.startsWith("pending-")) {
        await invoke("pty_kill", { id }).catch(swallow);
      }

      // Panels bound to the dying tab must not outlive it.
      closeQuickPanelForTab(id);
      closeFindForTab(id);

      // Find the next live tab to the right. Non-tab elements share the #tabs
      // container (the new-tab group is the last flex item), and the settings
      // tab is skipped too — anything without a live tab id must not count,
      // or closing the rightmost tab silently strands the window blank.
      let nextEl: Element | null = tab.tabElement.nextElementSibling;
      while (nextEl && !this.tabs.has((nextEl as HTMLElement).dataset.tabId ?? "")) {
        nextEl = nextEl.nextElementSibling;
      }

      const remaining = Array.from(this.tabs.keys()).filter((k) => k !== id);
      const wasActive = this.activeTabId === id;

      tab.destroy();
      this.tabs.delete(id);
      this._mru = this._mru.filter((x) => x !== id);

      if (wasActive) {
        if (nextEl) {
          const nextId = (nextEl as HTMLElement).dataset.tabId;
          if (nextId) this.switchTo(nextId);
        } else if (remaining.length > 0) {
          this.switchTo(remaining[remaining.length - 1]);
        } else {
          this.activeTabId = null;
          // Nothing to switch to: the permanent #welcome backdrop shows
          // through (settings, if open, covers it via z-index).
        }
      }
      this.refreshBadges();
      updateQuickButton();
      notifyTrayTabs();
    } finally {
      this._closing.delete(id);
    }
  }

  get(id: string): TerminalTab | undefined {
    return this.tabs.get(id);
  }

  // Tray restore: activate a tab by its position (matches the submenu order).
  activateTabAt(index: number): void {
    const ids = [...this.tabs.keys()];
    const id = ids[index];
    if (id !== undefined) this.switchTo(id);
  }

  get activeTab(): TerminalTab | undefined {
    return this.activeTabId ? this.tabs.get(this.activeTabId) : undefined;
  }

  // MRU-ordered live tab ids (front = most recently active) for the Ctrl+Tab switcher.
  mruTabIds(): string[] {
    return this._mru.filter((id) => this.tabs.has(id));
  }

  getTabIndex(id: string): number {
    const tab = this.tabs.get(id);
    if (!tab?.tabElement.parentElement) return -1;
    return Array.from(tab.tabElement.parentElement.children)
      .filter((el) => (el as HTMLElement).dataset.tabId !== "#settings")
      .indexOf(tab.tabElement);
  }

  refreshBadges(): void {
    const els = this.tabsContainer.querySelectorAll<HTMLElement>(".tab[data-tab-id^='tab-']");
    els.forEach((el, i) => {
      const badge = el.querySelector(".tab-badge") as HTMLElement;
      if (badge) badge.textContent = String(i + 1);
      const id = el.dataset.tabId;
      if (id) {
        const tab = this.tabs.get(id);
        if (tab) tab.index = i;
      }
    });
    this._syncTabsOverflow();
  }

  // Gate the +/dropdown pinning: only when the strip actually scrolls does
  // #new-tab-group go sticky (otherwise sticky misaligns it). Width changes
  // land here via refreshBadges (tab add/close) and _onResize.
  private _syncTabsOverflow(): void {
    syncTabStripState(this.tabsContainer);
  }

  // -- tab features --

  renameTab(id: string): void {
    actionRenameTab(this, id);
  }

  async shareTab(id: string): Promise<void> {
    await actionShareTab(this, id);
  }

  clearTab(id: string): void {
    actionClearTab(this, id);
  }

  async duplicateTab(id: string): Promise<void> {
    await actionDuplicateTab(this, id);
  }

  exportTab(id: string): void {
    actionExportTab(this, id);
  }

  closeTabsRight(id: string): void {
    actionCloseTabsRight(this, id);
  }

  closeOtherTabs(id: string): void {
    actionCloseOtherTabs(this, id);
  }

  // -- settings (lifecycle lives in terminal/settingsshell.ts) --

  // Called once real containers exist (same timing as initSortable).
  initSettingsShell(): void {
    this._settings = new SettingsShell(this.tabsContainer, this.terminalContainer, {
      hideActiveView: () => {
        for (const tab of this.tabs.values()) tab.hide();
      },
      restoreActiveView: () => {
        const tab = this.activeTabId ? this.tabs.get(this.activeTabId) : undefined;
        if (tab) {
          tab.show();
          if (tab.needsResize) tab.fitDeferred();
        }
        // No tabs left: nothing to restore — the #welcome backdrop is
        // already showing through (no state to manage).
      },
      syncStrip: () => this._syncTabsOverflow(),
    });
  }

  setSettingsFactory(fn: () => Promise<HTMLElement>): void {
    this._settings.setFactory(fn);
  }

  toggleSettings(): void {
    this._settings.toggle();
  }

  closeSettings(restore?: boolean): void {
    this._settings.close(restore ?? true);
  }

  // -- resize --

  // One fit pipeline for both callers. `settle` adds a double-rAF second
  // pass — needed after FONT/config changes (cell metrics drift: xterm
  // re-measures, the WebGL renderer rounds cell dims by dpr), pointless
  // for window resizes where metrics are unchanged.
  // Backend size tracking rides terminal.onResize (tab.ts) — no manual
  // pty_resize here or it fires twice per change.
  private _scheduleFitActive(settle: boolean): void {
    const active = this.activeTab;
    if (!active) return;
    if (this._resizeTimer) clearTimeout(this._resizeTimer);
    this._resizeTimer = setTimeout(() => {
      this._resizeTimer = null;
      // The tab may have been closed within the 10ms window (Ctrl+W,
      // clean-exit auto-close): fit() on a disposed terminal throws.
      if (!this.tabs.has(active.id)) return;
      if (active.element.style.display === "none") return;
      active.fit();
      active.needsResize = false;
      if (settle) active.fitDeferred();
    }, 10);
  }

  private _onResize(): void {
    for (const t of this.tabs.values()) t.needsResize = true;
    this._syncTabsOverflow();
    this._scheduleFitActive(false);
  }

  // Public resize trigger — called after font/config changes that affect cell metrics.
  triggerResize(): void {
    for (const t of this.tabs.values()) t.needsResize = true;
    this._scheduleFitActive(true);
  }

  // -- new-tab button --

  initNewTabButton(): void {
    const btn = mustGetById(DOM_ID.newTab);
    btn.title = "New tab (Shift+click: open in folder, right-click: recent folders)";

    // Same lucide icon as the recent-dirs menu's "Browse…" entry; shown in
    // place of the plus while Shift is held (see .shift-mode in styles.css).
    const folderIcon = createElement(FolderOpen, { stroke: "currentColor", width: 14, height: 14 });
    folderIcon.classList.add("folder-icon");
    btn.appendChild(folderIcon);

    // Shift+click opens a folder picker: reflect that while Shift is held
    // over the button (folder icon + blue hover via .shift-mode).
    const setShiftMode = (on: boolean) => btn.classList.toggle("shift-mode", on);
    btn.addEventListener("mouseenter", (e) => setShiftMode(e.shiftKey));
    btn.addEventListener("mousemove", (e) => setShiftMode(e.shiftKey));
    document.addEventListener("keydown", (e) => {
      if (e.key === "Shift" && btn.matches(":hover")) setShiftMode(true);
    });
    document.addEventListener("keyup", (e) => {
      if (e.key === "Shift") setShiftMode(false);
    });

    btn.addEventListener("click", (e) => {
      if (e.shiftKey) {
        import("./dirmenu").then((m) => m.pickAndLaunchDirectory());
        return;
      }
      const p = this.defaultLocalProfile();
      if (p) this.createLocalTab(p.command, p.name);
      else this.createLocalTab();
    });
    btn.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      import("./dirmenu").then((m) => m.showDirectoryMenu(btn));
    });
  }
}

// -- singleton ---

export const tabManager = new TabManager();

export function initTabManager(
  tabsContainer: HTMLElement,
  terminalContainer: HTMLElement,
): TabManager {
  Object.assign(tabManager, { tabsContainer, terminalContainer });
  tabManager.initSortable();
  tabManager.initSettingsShell();
  setTrayTabsProvider(() => ({
    tabs: [...tabManager.tabs.values()].map((t) => t.label),
    active: tabManager.activeTab?.label ?? "",
  }));
  return tabManager;
}
