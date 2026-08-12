import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { writeText as clipboardWriteText } from "@tauri-apps/plugin-clipboard-manager";
import { createElement, FolderOpen } from "lucide";
import Sortable from "sortablejs";
import { findSerialProfile } from "../config/serial-profiles";
import { hostProp } from "../core/common";
import { logCatch } from "../core/errorlog";
import { configStore } from "../core/store";
import { notifyTrayTabs, setTrayTabsProvider } from "../core/traytabs";
import type {
  SerialEnterNewline,
  SerialInputMode,
  SerialOutputNewline,
  SerialPort,
  SshHost,
  WsConnectResult,
} from "../core/types";
import { showToast } from "../ui/toast";
import { addForward, type NewForward } from "./forwarding";
import { closeQuickPanel, closeQuickPanelForTab, updateQuickButton } from "./quickpanel";
import { closeFindForTab } from "./search";
import { TerminalTab } from "./tab";

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
  settingsOpen = false;

  // Most-recently-used tab ids, front = current. Drives the Ctrl+Tab
  // switcher order. Updated on switch, pruned on close.
  private _mru: string[] = [];

  private settingsEl: HTMLElement | null = null;
  private settingsTabEl: HTMLElement | null = null;
  private _createSettingsContent: (() => Promise<HTMLElement>) | null = null;

  readonly tabsContainer: HTMLElement;
  readonly terminalContainer: HTMLElement;
  private readonly _welcomeEl: HTMLElement;

  private _resizeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(tabsContainer: HTMLElement, terminalContainer: HTMLElement, welcomeEl: HTMLElement) {
    this.tabsContainer = tabsContainer;
    this.terminalContainer = terminalContainer;
    this._welcomeEl = welcomeEl;

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
          .catch(() => {});
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
      import("./contextmenu").then((m) => m.showTabContextMenu(tab.id, e.clientX, e.clientY));
    });

    tab.tabElement = el;
    return el;
  }

  // Rebuild the tabs Map in DOM order after a drag reorder.
  private _syncTabOrderFromDom(): void {
    const ordered = new Map<string, TerminalTab>();
    for (const el of this.tabsContainer.querySelectorAll<HTMLElement>(
      '.tab[data-tab-id^="tab-"]',
    )) {
      const tab = this.tabs.get(el.dataset.tabId!);
      if (tab) ordered.set(tab.id, tab);
    }
    this.tabs = ordered;
  }

  private _register(tab: TerminalTab, port: number, token: string): void {
    const tabEl = this._createTabElement(tab);
    // Keep the + button group as the last child of #tabs (flush after the
    // last tab).
    this.tabsContainer.insertBefore(tabEl, document.getElementById("new-tab-group"));

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
    const tab = new TerminalTab(result.id, "local", label || "Terminal", this.terminalContainer);
    if (command) {
      tab.command = command;
    }
    return this._finalizeTab(tab, result);
  }

  async createSshTab(host: SshHost): Promise<TerminalTab | null> {
    let result: WsConnectResult;
    // The embedded connect can block for many seconds (TCP + handshake +
    // auth dialog) with no tab on screen yet — keep a pending toast up for
    // the whole attempt so the click doesn't feel lost.
    let pending: { dismiss(): void } | null = null;
    try {
      if (configStore.get("sshEmbedded")) {
        const target = `${hostProp(host, "user") || "root"}@${hostProp(host, "hostname") || host.name}`;
        pending = showToast(`Connecting to ${target}…`, "info", 60000);
        // Built-in client: password/key prompts and host-key confirmation
        // come up as dialogs; port forwarding is available on the tab menu.
        result = await invoke("ssh_spawn_embedded", {
          spec: {
            hostname: hostProp(host, "hostname") || host.name,
            port: parseInt(hostProp(host, "port") || "22", 10),
            user: hostProp(host, "user") || "root",
            identityFile: hostProp(host, "identityfile") || null,
          },
        });
      } else {
        result = await invoke("pty_spawn_ssh", {
          hostname: hostProp(host, "hostname") || host.name,
          port: parseInt(hostProp(host, "port") || "22", 10),
          user: hostProp(host, "user") || "root",
        });
      }
    } catch (e) {
      // A cancelled password/host-key prompt is a deliberate abort, not a
      // failure — close the attempt quietly.
      if (!String(e).toLowerCase().includes("cancelled")) {
        showToast(`Failed to start SSH session: ${e}`, "error");
      }
      return null;
    } finally {
      pending?.dismiss();
    }
    const tab = new TerminalTab(result.id, "ssh", host.name, this.terminalContainer);
    tab.sshHost = host;
    tab.sshEmbedded = configStore.get("sshEmbedded");
    const finalized = await this._finalizeTab(tab, result);
    // Persisted host forwards (LocalForward / RemoteForward in ssh config)
    // are applied on connect for the embedded client; the system-ssh path
    // gets them from OpenSSH itself.
    if (finalized && tab.sshEmbedded) this._applyConfigForwards(result.id, host);
    return finalized;
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
      });
    } catch (e) {
      showToast(String(e), "error");
      return null;
    }
    const tab = new TerminalTab(
      result.id,
      "serial",
      `${port.name} · ${baud}`,
      this.terminalContainer,
    );
    tab.serialPortName = port.name;
    tab.serialBaud = baud;
    tab.serialProfile = profile.name;
    tab.outputNewline = profile.outputNewline;
    tab.enterNewline = profile.enterNewline;
    tab.inputMode = profile.inputMode;
    tab.flowControl = profile.flowControl;
    return this._finalizeTab(tab, result);
  }

  // Apply a profile to a live serial session: input mode + Enter terminator
  // (frontend input handler), output newline + flow control (backend).
  // The choice becomes the global default for the next tab.
  async setSerialProfile(tabId: string, name: string): Promise<void> {
    const tab = this.tabs.get(tabId);
    if (tab?.type !== "serial") return;
    const profile = findSerialProfile(name);
    tab.setSerialInputMode(profile.inputMode);
    tab.setSerialEnterNewline(profile.enterNewline);
    await invoke("serial_set_output_newline", { id: tabId, mode: profile.outputNewline });
    await invoke("serial_set_flow_control", { id: tabId, flow: profile.flowControl });
    tab.outputNewline = profile.outputNewline;
    tab.flowControl = profile.flowControl;
    tab.serialProfile = profile.name;
    configStore.set({ serialProfile: profile.name });
  }

  // Live Enter-key newline switch (frontend-side, this session only).
  async setSerialEnterNewline(tabId: string, mode: SerialEnterNewline): Promise<void> {
    const tab = this.tabs.get(tabId);
    if (tab?.type !== "serial") return;
    tab.setSerialEnterNewline(mode);
  }

  // Live input-mode switch for an open serial session (this session only).
  setSerialInputMode(tabId: string, mode: SerialInputMode): void {
    const tab = this.tabs.get(tabId);
    if (tab?.type !== "serial") return;
    tab.setSerialInputMode(mode);
  }

  // Live output-newline switch for an open serial session (this session only).
  async setSerialOutputNewline(tabId: string, mode: SerialOutputNewline): Promise<void> {
    const tab = this.tabs.get(tabId);
    if (tab?.type !== "serial") return;
    await invoke("serial_set_output_newline", { id: tabId, mode });
    tab.outputNewline = mode;
  }

  // Live baud switch for an open serial session (this session only).
  async setSerialBaud(tabId: string, baud: number): Promise<void> {
    const tab = this.tabs.get(tabId);
    if (tab?.type !== "serial" || !tab.serialPortName) return;
    await invoke("serial_set_baud", { id: tabId, baudRate: baud });
    tab.serialBaud = baud;
    // Baud display update, not a user rename — keep OSC title tracking live.
    tab.rename(`${tab.serialPortName} · ${baud}`, false);
  }

  async createDemoTab(): Promise<TerminalTab | null> {
    let result: WsConnectResult;
    try {
      result = await invoke("demo_spawn");
    } catch (e) {
      showToast(String(e), "error");
      return null;
    }
    const tab = new TerminalTab(result.id, "local", "Demo TTY", this.terminalContainer);
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
    const tab = new TerminalTab(result.id, "local", "Anime TTY", this.terminalContainer);
    return this._finalizeTab(tab, result);
  }

  // Shared tail of every create*Tab: register with the hub, wait out the
  // web-font race, then show + fit.
  private async _finalizeTab(tab: TerminalTab, result: WsConnectResult): Promise<TerminalTab> {
    this._register(tab, result.port, result.token);
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
    this._mru = [id, ...this._mru.filter((x) => x !== id)];
    // The quick panel tracks the active tab; switching closes it.
    closeQuickPanel();
    updateQuickButton();
    // The tray submenu lists this window's tabs; the title follows the
    // active tab's label.
    notifyTrayTabs();

    if (next.needsResize) {
      const { cols, rows } = next.fit();
      next.needsResize = false;
      invoke("pty_resize", { id: next.id, cols, rows });
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
      if (tab.shared) invoke("share_revoke", { id }).catch(() => {});
      // UI close must not depend on the backend ack.
      await invoke("pty_kill", { id }).catch(() => {});

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
          this.switchTo((nextEl as HTMLElement).dataset.tabId!);
        } else if (remaining.length > 0) {
          this.switchTo(remaining[remaining.length - 1]);
        } else {
          this.activeTabId = null;
          this._showWelcome();
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
    const tab = this.tabs.get(id);
    if (!tab) return;
    const labelEl = tab.tabElement.querySelector(".tab-label") as HTMLElement | null;
    if (!labelEl || labelEl.querySelector("input")) return;

    // Inline editing: the native prompt() dialog shows the dev URL as its
    // title ("127.0.0.1:1420 says…") and looks foreign to the app.
    const input = document.createElement("input");
    input.className = "tab-rename-input";
    input.value = tab.label;
    labelEl.textContent = "";
    labelEl.appendChild(input);

    // Editing must not trigger tab switching or SortableJS drag.
    for (const ev of ["click", "dblclick", "mousedown", "pointerdown"]) {
      input.addEventListener(ev, (e) => e.stopPropagation());
    }

    let done = false;
    const finish = (save: boolean) => {
      if (done) return;
      done = true;
      const name = input.value.trim();
      if (save && name && name !== tab.label) {
        tab.rename(name); // also locks the OSC title
      } else if (save && !name && tab.titleLocked) {
        tab.resetTitle(); // emptied: back to tracking the terminal title
      } else {
        labelEl.textContent = tab.label;
      }
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        finish(true);
      } else if (e.key === "Escape") {
        e.preventDefault();
        finish(false);
      }
      e.stopPropagation();
    });
    input.addEventListener("blur", () => finish(true));

    input.focus();
    input.select();
  }

  async shareTab(id: string): Promise<void> {
    const tab = this.tabs.get(id);
    if (!tab) return;
    if (tab.shared) {
      await invoke("share_revoke", { id }).catch(logCatch("share.revoke"));
      tab.shared = false;
      tab.shareUrl = undefined;
      tab.tabElement.classList.remove("shared");
      showToast("AI sharing stopped", "info");
      updateQuickButton();
      return;
    }
    try {
      const res = await invoke<{ url: string }>("share_create", {
        id,
        label: tab.label,
        kind: tab.type,
        allowWrite: true,
      });
      await clipboardWriteText(res.url).catch(logCatch("clipboard.write"));
      tab.shared = true;
      tab.shareUrl = res.url;
      tab.tabElement.classList.add("shared");
      showToast("Share link copied — paste it to your AI agent", "info", 6000);
      updateQuickButton();
    } catch (e) {
      showToast(`Failed to share session: ${e}`, "error");
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
    const ids = Array.from(this.tabs.keys()).filter((tid) => this.getTabIndex(tid) > idx);
    for (const tid of ids) this.closeTab(tid);
  }

  closeOtherTabs(id: string): void {
    const ids = Array.from(this.tabs.keys()).filter((tid) => tid !== id);
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
    closeQuickPanel();
    updateQuickButton();

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
      this._syncTabsOverflow();
    }
    this.settingsTabEl.classList.add("active");
    const sCloseBtn = this.settingsTabEl.querySelector(".tab-close") as HTMLElement;
    if (sCloseBtn) sCloseBtn.style.opacity = "1";

    const settingsEl = await this._createSettingsContent();
    // The factory is a dynamic import — genuinely async. If the user
    // closed settings (or switched to a tab) while it was in flight,
    // discard the page: appending it now would stick it on screen with
    // no live settings tab to dismiss it.
    if (!this.settingsOpen) return;
    this.settingsEl = settingsEl;
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
        this._syncTabsOverflow();
      } else {
        this.settingsTabEl.classList.remove("active");
        const sCloseBtn = this.settingsTabEl.querySelector(".tab-close") as HTMLElement;
        if (sCloseBtn) sCloseBtn.style.opacity = "";
      }
    }

    this.settingsOpen = false;
    updateQuickButton();

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
    this._syncTabsOverflow();

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
      // Cell metrics drift AFTER a font change (xterm re-measures, the
      // WebGL renderer rounds cell dims by dpr): the fit above can compute
      // one row too many with stale metrics, clipping the bottom line.
      // fitDeferred's double-rAF second pass re-fits with settled metrics.
      active.fitDeferred();
    }, 10);
  }

  // -- new-tab button --

  initNewTabButton(): void {
    const btn = document.getElementById("new-tab")!;
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

  // -- helpers ---

  private _hideWelcome(): void {
    this._welcomeEl.style.display = "none";
  }
  private _showWelcome(): void {
    this._welcomeEl.style.display = "flex";
  }
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
  setTrayTabsProvider(() => ({
    tabs: [...tabManager.tabs.values()].map((t) => t.label),
    active: tabManager.activeTab?.label ?? "",
  }));
  return tabManager;
}
