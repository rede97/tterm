import { invoke } from "@tauri-apps/api/core";
import { SshHost, localProfiles, defaultLocalProfile, hostProp, SerialPort, serialParamsFor, serialKeyFor, rememberSerialParams, SerialOutputNewline } from "./profiles";
import { showToast } from "./toast";
import { TerminalTab } from "./tab";
import Sortable from "sortablejs";

export class TabManager {
  tabs = new Map<string, TerminalTab>();
  activeTabId: string | null = null;
  settingsOpen = false;

  private settingsEl: HTMLElement | null = null;
  private settingsTabEl: HTMLElement | null = null;
  private _createSettingsContent: (() => Promise<HTMLElement>) | null = null;

  readonly tabsContainer: HTMLElement;
  readonly terminalContainer: HTMLElement;
  private readonly _welcomeEl: HTMLElement;

  private _resizeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    tabsContainer: HTMLElement,
    terminalContainer: HTMLElement,
    welcomeEl: HTMLElement,
  ) {
    this.tabsContainer = tabsContainer;
    this.terminalContainer = terminalContainer;
    this._welcomeEl = welcomeEl;

    window.addEventListener("resize", () => this._onResize());
  }

  // Tab drag reorder via SortableJS (mature pointer math; forceFallback
  // avoids the unreliable native HTML5 drag-and-drop in WebView2).
  // Must be called after the real containers are injected (the module-level
  // singleton is constructed with nulls).
  initSortable(): void {
    new Sortable(this.tabsContainer, {
      animation: 150,
      direction: "horizontal",
      draggable: ".tab[data-tab-id^=\"tab-\"]",
      filter: ".tab-close",
      preventOnFilter: false,
      forceFallback: true,
      fallbackTolerance: 5,
      onEnd: () => {
        this._syncTabOrderFromDom();
        this.refreshBadges();
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

    const closeBtn = document.createElement("button");
    closeBtn.className = "tab-close";
    closeBtn.textContent = "\xd7";
    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.closeTab(tab.id);
    });
    el.appendChild(closeBtn);

    el.addEventListener("click", () => this.switchTo(tab.id));
    el.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      import("./contextmenu").then(m => m.showTabContextMenu(tab.id, e.clientX, e.clientY));
    });

    tab.tabElement = el;
    return el;
  }

  // Rebuild the tabs Map in DOM order after a drag reorder.
  private _syncTabOrderFromDom(): void {
    const ordered = new Map<string, TerminalTab>();
    for (const el of this.tabsContainer.querySelectorAll<HTMLElement>(".tab[data-tab-id^=\"tab-\"]")) {
      const tab = this.tabs.get(el.dataset.tabId!);
      if (tab) ordered.set(tab.id, tab);
    }
    this.tabs = ordered;
  }

  private _register(tab: TerminalTab, port: number): void {
    const tabEl = this._createTabElement(tab);
    this.tabsContainer.appendChild(tabEl);

    tab.onSocketClosed = () => this._onSessionClosed(tab.id);
    tab.onReconnectRequested = () => this.reconnectTab(tab.id);
    tab.attachSocket(port);

    this.tabs.set(tab.id, tab);
  }

  // Session socket closed => PTY exited / serial pump died: show the overlay.
  private _onSessionClosed(tabId: string): void {
    const tab = this.tabs.get(tabId);
    if (!tab || tab.disconnected || this._reconnecting.has(tabId)) return;
    tab.setDisconnected(true);
  }

  private _reconnecting = new Set<string>();

  // Respawn the session backend-side (same id) and re-attach the socket.
  async reconnectTab(tabId: string): Promise<void> {
    const tab = this.tabs.get(tabId);
    if (!tab) return;
    this._reconnecting.add(tabId);
    try {
      const result: { id: string; port: number } = await invoke("session_reconnect", { id: tabId });
      tab.setDisconnected(false);
      tab.attachSocket(result.port);
      tab.terminal.focus();
    } catch (e) {
      showToast(`Reconnect failed: ${e}`, "error");
    } finally {
      this._reconnecting.delete(tabId);
    }
  }

  async createLocalTab(command?: string, label?: string): Promise<TerminalTab | null> {
    let result: { id: string; port: number };
    try {
      result = await invoke("pty_spawn", command ? { command } : {});
    } catch (e) {
      showToast(`Failed to start shell: ${e}`, "error");
      return null;
    }
    const tab = new TerminalTab(result.id, "local", label || "Terminal", this.terminalContainer);
    if (command) { tab.command = command; }
    this._register(tab, result.port);

    await this._ensureFontsReady(tab);

    this._hideWelcome();
    this.switchTo(result.id);
    tab.fitDeferred();
    this.refreshBadges();

    return tab;
  }

  async createSshTab(host: SshHost): Promise<TerminalTab | null> {
    let result: { id: string; port: number };
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
    const tab = new TerminalTab(result.id, "ssh", host.name, this.terminalContainer);
    tab.sshHost = host;
    this._register(tab, result.port);

    await this._ensureFontsReady(tab);

    this._hideWelcome();
    this.switchTo(result.id);
    tab.fitDeferred();
    this.refreshBadges();

    return tab;
  }

  async createSerialTab(port: SerialPort): Promise<TerminalTab | null> {
    const params = serialParamsFor(port);
    let result: { id: string; port: number };
    try {
      result = await invoke("serial_spawn", {
        portName: port.name,
        baudRate: params.baud,
        dataBits: 8,
        parity: "none",
        stopBits: 1,
        flowControl: "none",
      });
    } catch (e) {
      showToast(String(e), "error");
      return null;
    }
    const tab = new TerminalTab(result.id, "serial", `${port.name} · ${params.baud}`, this.terminalContainer);
    tab.serialPortName = port.name;
    tab.serialKey = serialKeyFor(port);
    tab.serialBaud = params.baud;
    tab.outputNewline = params.outputNewline;
    tab.inputMode = params.inputMode;
    this._register(tab, result.port);

    await this._ensureFontsReady(tab);

    this._hideWelcome();
    this.switchTo(result.id);
    tab.fitDeferred();
    this.refreshBadges();

    return tab;
  }

  // Live output-newline switch for an open serial session; persists memory.
  async setSerialOutputNewline(tabId: string, mode: SerialOutputNewline): Promise<void> {
    const tab = this.tabs.get(tabId);
    if (!tab || tab.type !== "serial" || !tab.serialKey) return;
    await invoke("serial_set_output_newline", { id: tabId, mode });
    tab.outputNewline = mode;
    await rememberSerialParams(tab.serialKey, { outputNewline: mode });
  }

  // Live baud switch for an open serial session; persists per-port memory.
  async setSerialBaud(tabId: string, baud: number): Promise<void> {
    const tab = this.tabs.get(tabId);
    if (!tab || tab.type !== "serial" || !tab.serialPortName || !tab.serialKey) return;
    await invoke("serial_set_baud", { id: tabId, baudRate: baud });
    tab.serialBaud = baud;
    await rememberSerialParams(tab.serialKey, { baud });
    tab.rename(`${tab.serialPortName} · ${baud}`);
  }

  async createDemoTab(): Promise<TerminalTab | null> {
    let result: { id: string; port: number };
    try {
      result = await invoke("demo_spawn");
    } catch (e) {
      showToast(String(e), "error");
      return null;
    }
    const tab = new TerminalTab(result.id, "local", "Demo TTY", this.terminalContainer);
    this._register(tab, result.port);

    await this._ensureFontsReady(tab);

    this._hideWelcome();
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
      this._closeSettings(false);
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

    if (next.needsResize) {
      const { cols, rows } = next.fit();
      next.needsResize = false;
      invoke("pty_resize", { id: next.id, cols, rows });
    }
  }

  async closeTab(id: string): Promise<void> {
    const tab = this.tabs.get(id);
    if (!tab) return;

    await invoke("pty_kill", { id });

    let nextEl: Element | null = tab.tabElement.nextElementSibling;
    while (nextEl && (nextEl as HTMLElement).dataset.tabId === "#settings") {
      nextEl = nextEl.nextElementSibling;
    }

    const remaining = Array.from(this.tabs.keys()).filter(k => k !== id);
    const wasActive = this.activeTabId === id;

    tab.destroy();
    this.tabs.delete(id);

    if (wasActive) {
      if (nextEl) {
        const nextId = (nextEl as HTMLElement).dataset.tabId!;
        if (this.tabs.has(nextId)) {
          this.switchTo(nextId);
        }
      } else if (remaining.length > 0) {
        this.switchTo(remaining[remaining.length - 1]);
      } else {
        this.activeTabId = null;
        this._showWelcome();
      }
    }
    this.refreshBadges();
  }

  get(id: string): TerminalTab | undefined {
    return this.tabs.get(id);
  }

  get activeTab(): TerminalTab | undefined {
    return this.activeTabId ? this.tabs.get(this.activeTabId) : undefined;
  }

  getTabIndex(id: string): number {
    const tab = this.tabs.get(id);
    if (!tab?.tabElement.parentElement) return -1;
    return Array.from(tab.tabElement.parentElement.children)
      .filter(el => (el as HTMLElement).dataset.tabId !== "#settings")
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
  }

  // -- tab features --

  renameTab(id: string): void {
    const tab = this.tabs.get(id);
    if (!tab) return;
    const newName = prompt("Rename tab", tab.label);
    if (newName && newName.trim()) {
      tab.rename(newName);
    }
  }

  clearTab(id: string): void {
    const tab = this.tabs.get(id);
    if (!tab) return;
    tab.terminal.clear();
  }

  async duplicateTab(id: string): Promise<void> {
    const tab = this.tabs.get(id);
    if (!tab) return;
    if (tab.type === "ssh" && tab.sshHost) {
      await this.createSshTab(tab.sshHost);
    } else if (tab.command) {
      await this.createLocalTab(tab.command, tab.label);
    } else {
      await this.createLocalTab(undefined, tab.label);
    }
  }

  exportTab(id: string): void {
    const tab = this.tabs.get(id);
    if (!tab) return;
    const buffer = tab.terminal.buffer.active;
    const lines: string[] = [];
    for (let y = 0; y < buffer.length; y++) {
      const line = buffer.getLine(y);
      if (line) lines.push(line.translateToString().trimEnd());
    }
    invoke("save_text_file", { content: lines.join("\n") }).catch(console.error);
  }

  closeTabsRight(id: string): void {
    const idx = this.getTabIndex(id);
    if (idx === -1) return;
    const ids = Array.from(this.tabs.keys()).filter(tid => this.getTabIndex(tid) > idx);
    for (const tid of ids) this.closeTab(tid);
  }

  closeOtherTabs(id: string): void {
    const ids = Array.from(this.tabs.keys()).filter(tid => tid !== id);
    for (const tid of ids) this.closeTab(tid);
  }

  // -- settings --

  setSettingsFactory(fn: () => Promise<HTMLElement>): void {
    this._createSettingsContent = fn;
  }

  toggleSettings(): void {
    if (this.settingsOpen) return;
    this._openSettings();
  }

  private async _openSettings(): Promise<void> {
    if (this.settingsEl || !this._createSettingsContent) return;

    this.settingsOpen = true;

    for (const tab of this.tabs.values()) tab.hide();

    if (!this.settingsTabEl) {
      this.settingsTabEl = document.createElement("div");
      this.settingsTabEl.className = "tab";
      this.settingsTabEl.dataset.tabId = "#settings";
      const label = document.createElement("span");
      label.className = "tab-label";
      label.textContent = "Settings";
      this.settingsTabEl.appendChild(label);
      const closeBtn = document.createElement("button");
      closeBtn.className = "tab-close";
      closeBtn.textContent = "\xd7";
      closeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this._closeSettings(true);
      });
      this.settingsTabEl.appendChild(closeBtn);
      this.settingsTabEl.addEventListener("click", () => this.toggleSettings());
      this.tabsContainer.insertBefore(this.settingsTabEl, this.tabsContainer.firstChild);
    }
    this.settingsTabEl.classList.add("active");
    const sCloseBtn = this.settingsTabEl.querySelector(".tab-close") as HTMLElement;
    if (sCloseBtn) sCloseBtn.style.opacity = "1";

    this.settingsEl = await this._createSettingsContent();
    this.terminalContainer.appendChild(this.settingsEl);
  }

  private _closeSettings(restore: boolean): void {
    if (this.settingsEl) {
      this.settingsEl.remove();
      this.settingsEl = null;
    }
    if (this.settingsTabEl) {
      if (restore) {
        this.settingsTabEl.remove();
        this.settingsTabEl = null;
      } else {
        this.settingsTabEl.classList.remove("active");
        const sCloseBtn = this.settingsTabEl.querySelector(".tab-close") as HTMLElement;
        if (sCloseBtn) sCloseBtn.style.opacity = "";
      }
    }

    this.settingsOpen = false;

    if (restore && this.activeTabId) {
      const tab = this.tabs.get(this.activeTabId);
      if (tab) {
        tab.show();
        if (tab.needsResize) tab.fitDeferred();
      }
    } else if (restore) {
      this._showWelcome();
    }
  }

  closeSettings(restore?: boolean): void {
    this._closeSettings(restore ?? true);
  }

  // -- resize --

  private _onResize(): void {
    for (const t of this.tabs.values()) t.needsResize = true;

    const active = this.activeTab;
    if (!active) return;

    if (this._resizeTimer) clearTimeout(this._resizeTimer);
    this._resizeTimer = setTimeout(() => {
      this._resizeTimer = null;
      if (active.element.style.display === "none") return;
      const { cols, rows } = active.fit();
      active.needsResize = false;
      invoke("pty_resize", { id: active.id, cols, rows });
    }, 10);
  }

  // Public resize trigger — called after font/config changes that affect cell metrics.
  triggerResize(): void {
    for (const t of this.tabs.values()) t.needsResize = true;
    const active = this.activeTab;
    if (!active) return;
    if (this._resizeTimer) clearTimeout(this._resizeTimer);
    this._resizeTimer = setTimeout(() => {
      this._resizeTimer = null;
      if (active.element.style.display === "none") return;
      const { cols, rows } = active.fit();
      active.needsResize = false;
      invoke("pty_resize", { id: active.id, cols, rows });
    }, 10);
  }

  // -- new-tab button --

  initNewTabButton(): void {
    const btn = document.getElementById("new-tab")!;
    btn.addEventListener("click", () => {
      const defName = defaultLocalProfile ?? localProfiles[0]?.name ?? null;
      const p = defName ? localProfiles.find(x => x.name === defName) : null;
      if (p) this.createLocalTab(p.command, p.name);
      else this.createLocalTab();
    });
  }

  // -- helpers ---

  private _hideWelcome(): void { this._welcomeEl.style.display = "none"; }
  private _showWelcome(): void { this._welcomeEl.style.display = "flex"; }
}

// -- singleton ---

export const tabManager = new TabManager(null!, null!, null!);

export function initTabManager(
  tabsContainer: HTMLElement,
  terminalContainer: HTMLElement,
  welcomeEl: HTMLElement,
): TabManager {
  Object.assign(tabManager, { tabsContainer, terminalContainer, _welcomeEl: welcomeEl });
  tabManager.initSortable();
  return tabManager;
}


