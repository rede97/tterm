// Composition root for handler injection.
//
// Feature modules (quickpanel / contextmenu / keymap / tabswitcher) never
// import TabManager — main-adjacent WIRING binds their handler slots to the
// manager here, keeping the module graph acyclic. main.ts calls these
// functions at startup instead of carrying the inline blocks.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { loadSerialPorts } from "./config/wt-profiles";
import { logCatch } from "./core/errorlog";
import { initKeymap } from "./core/keymap";
import { configStore } from "./core/store";
import { setDirMenuHandlers } from "./terminal/dirmenu";
import { pasteIntoTerminal } from "./terminal/paste";
import { setSearchHandlers } from "./terminal/search";
import { setSshAuthTabLookup } from "./terminal/sshauth";
import type { TerminalTab } from "./terminal/tab";
import { tabManager } from "./terminal/tabmanager";
import { confirmDialog } from "./ui/confirm";
import { listForwards, removeForward } from "./ui/forwarding";
import { openCommandPalette, openPaletteFlow, setPaletteHandlers } from "./ui/palette";
import { openQuickOpen, setTabSwitcherHandlers, stepMruSwitcher } from "./ui/tabswitcher";
import { toggleFullscreenMode, toggleZenMode } from "./ui/window";

// Keyboard shortcuts: global dispatcher (core/keymap) + tab switcher overlay.
// Commands are rebindable in Settings → Keyboard.
export function initShortcutsWiring(): void {
  const toItem = ([id, t]: [string, TerminalTab], i: number) => ({
    id,
    label: t.label,
    index: i + 1,
    active: id === tabManager.activeTabId,
    disconnected: t.disconnected,
  });
  setTabSwitcherHandlers({
    listTabs: (mode) => {
      const entries = [...tabManager.tabs.entries()];
      if (mode === "mru") {
        const byId = new Map(entries);
        return tabManager.mruTabIds().flatMap((id) => {
          const i = entries.findIndex(([eid]) => eid === id);
          const tab = byId.get(id);
          return tab ? [toItem([id, tab], i)] : [];
        });
      }
      return entries.map((e, i) => toItem(e, i));
    },
    switchTo: (id) => tabManager.switchTo(id),
    onCommandFlip: (query) => openCommandPalette(query),
  });
  setPaletteHandlers({
    listLocalProfiles: () =>
      configStore
        .get("localProfiles")
        .filter((p) => !configStore.get("hiddenProfiles").includes(p.name)),
    listSshHosts: () =>
      configStore
        .get("sshHosts")
        .filter((h) => !configStore.get("hiddenSshHosts").includes(h.name)),
    listSerialPorts: () => loadSerialPorts(),
    openLocalTab: (command, label) => void tabManager.createLocalTab(command, label),
    openSshTab: (host, password) => void tabManager.createSshTab(host, password),
    openSerialTab: (port) => void tabManager.createSerialTab(port),
    getActiveTab: () => {
      const t = tabManager.settingsOpen ? null : tabManager.activeTab;
      return t ? { id: t.id, type: t.type, sshEmbedded: t.sshEmbedded } : null;
    },
    setSerialBaud: (id, baud) => tabManager.setSerialBaud(id, baud),
    setSerialProfile: (id, name) => tabManager.setSerialProfile(id, name),
    setSerialFlow: (id, flow) => {
      const t = tabManager.get(id);
      if (!t) return;
      t.flowControl = flow;
      invoke("serial_set_flow_control", { id, flow }).catch(logCatch("serial.setFlow"));
    },
    flipToQuickOpen: (query) => openQuickOpen(query),
  });
  initKeymap({
    "workbench.action.quickOpen": () => openQuickOpen(),
    "workbench.action.nextTab": () => stepMruSwitcher(1),
    "workbench.action.prevTab": () => stepMruSwitcher(-1),
    "workbench.action.closeTab": () => {
      if (tabManager.settingsOpen) {
        tabManager.closeSettings(true);
        return;
      }
      if (tabManager.activeTabId) tabManager.closeTab(tabManager.activeTabId);
    },
    "workbench.action.toggleFullScreen": () => {
      toggleFullscreenMode()
        .then(() => tabManager.triggerResize())
        .catch(logCatch("window.fullScreen"));
    },
    "workbench.action.toggleZenMode": () => {
      toggleZenMode()
        .then(() => tabManager.triggerResize())
        .catch(logCatch("window.zenMode"));
    },
    "workbench.action.terminal.clear": () => {
      const t = tabManager.activeTab;
      if (t) t.terminal.clear();
    },
    "workbench.action.showCommands": () => openCommandPalette(),
    "workbench.action.newTab": () => void tabManager.createLocalTab(),
    "workbench.action.openSettings": () => tabManager.toggleSettings(),
    "tterm.newTabPicker": () => openPaletteFlow("newTab"),
    "tterm.newWindow": () => invoke("open_new_window").catch(logCatch("window.openNew")),
    "tterm.toggleQuickPanel": () => {
      document.getElementById("quick-status")?.click();
    },
    "tterm.shareStart": () => {
      const t = tabManager.activeTab;
      if (t && !t.shared) tabManager.shareTab(t.id);
    },
    "tterm.shareStop": () => {
      const t = tabManager.activeTab;
      if (t?.shared) tabManager.shareTab(t.id);
    },
    "tterm.duplicateTab": () => {
      if (tabManager.activeTabId) tabManager.duplicateTab(tabManager.activeTabId);
    },
    "tterm.closeWindow": () => invoke("window_request_close").catch(logCatch("window.close")),
    "tterm.sshAutoReconnect": () => {
      const t = tabManager.activeTab;
      if (t?.type !== "ssh") return;
      void invoke<boolean>("session_get_auto_reconnect", { id: t.id })
        .then((v) => invoke("session_set_auto_reconnect", { id: t.id, enabled: !v }))
        .catch(logCatch("ssh.autoReconnect"));
    },
    "tterm.forwardAddLocal": () => openPaletteFlow("forwardLocal"),
    "tterm.forwardAddRemote": () => openPaletteFlow("forwardRemote"),
    "tterm.forwardAddDynamic": () => openPaletteFlow("forwardDynamic"),
    "tterm.forwardRemoveAll": () => {
      const t = tabManager.activeTab;
      if (t?.type !== "ssh" || !t.sshEmbedded) return;
      void listForwards(t.id).then(async (forwards) => {
        if (!forwards) return;
        for (const f of forwards) await removeForward(t.id, f.forwardId);
      });
    },
    "tterm.tempSsh": () => openPaletteFlow("tempSsh"),
    "tterm.portForwards": () => openPaletteFlow("forwards"),
    "tterm.serialProfile": () => openPaletteFlow("serialProfile"),
    "tterm.serialBaud": () => openPaletteFlow("serialBaud"),
    "tterm.serialFlow": () => openPaletteFlow("serialFlow"),
  });
}

export function initQuickPanelWiring(): void {
  import("./terminal/quickpanel").then((m) => {
    m.setQuickPanelHandlers({
      getActiveTab: () => (tabManager.settingsOpen ? undefined : tabManager.activeTab),
      getTab: (id) => tabManager.get(id),
      shareTab: (id) => tabManager.shareTab(id),
      setSerialBaud: (id, baud) => tabManager.setSerialBaud(id, baud),
      setSerialProfile: (id, name) => tabManager.setSerialProfile(id, name),
      setSerialInputMode: (id, mode) => tabManager.setSerialInputMode(id, mode),
      setSerialOutputNewline: (id, mode) => tabManager.setSerialOutputNewline(id, mode),
      setSerialEnterNewline: (id, mode) => tabManager.setSerialEnterNewline(id, mode),
    });
    m.initQuickPanel();
  });
}

export function initContextMenuWiring(): void {
  import("./terminal/contextmenu").then((m) => {
    m.setContextMenuHandlers({
      createLocalTab: () => tabManager.createLocalTab(),
      newWindow: () => invoke("open_new_window").catch(logCatch("window.openNew")),
      getTabLabel: (id) => tabManager.get(id)?.label ?? "",
      setTabColor: (id, color) => tabManager.get(id)?.setColor(color),
      renameTab: (id) => tabManager.renameTab(id),
      duplicateTab: (id) => tabManager.duplicateTab(id),
      closeTab: (id) => tabManager.closeTab(id),
      closeTabsRight: (id) => tabManager.closeTabsRight(id),
      closeOtherTabs: (id) => tabManager.closeOtherTabs(id),
      getSelection: (id) => tabManager.get(id)?.terminal.getSelection() ?? "",
      pasteToTab: (id, text) => {
        const t = tabManager.get(id);
        if (t) pasteIntoTerminal(t.terminal, text);
      },
      clearTab: (id) => tabManager.clearTab(id),
      switchTo: (id) => tabManager.switchTo(id),
      exportTab: (id) => tabManager.exportTab(id),
      getActiveTabId: () => tabManager.activeTabId,
      shareTab: (id) => tabManager.shareTab(id),
      isTabShared: (id) => tabManager.get(id)?.shared ?? false,
      getShareUrl: (id) => tabManager.get(id)?.shareUrl,
      getTabColor: (id) => tabManager.get(id)?.color,
    });
    m.initContextMenu();
  });
}

export function initSearchWiring(): void {
  setSearchHandlers({ getTab: (id) => tabManager.get(id) });
}

// Close-window confirmation (docs/confirm-preview.html): the backend
// prevents every close request (X button, Alt+F4, taskbar) and asks via
// event. Confirm only when the setting is on AND tabs are open — anything
// else re-issues window_close, whose confirmed flag lets the close pass.
export function initWindowCloseConfirm(): void {
  // De-dupe: a confirm is already up (e.g. double Alt+F4).
  let asking = false;
  void listen("window-close-requested", () => {
    const tabCount = tabManager.tabs.size;
    if (!configStore.get("confirmCloseWindow") || tabCount === 0 || asking) {
      if (!asking) void invoke("window_close").catch(logCatch("window.close"));
      return;
    }
    asking = true;
    void confirmDialog({
      title: "Close window?",
      message: `This window has ${tabCount} open tab${tabCount === 1 ? "" : "s"}. Closing it ends those sessions.`,
      meta: "You can turn this prompt off in Settings → General → Confirm before closing window.",
      okLabel: "Close window",
      danger: true,
    }).then((ok) => {
      asking = false;
      if (ok) void invoke("window_close").catch(logCatch("window.close"));
    });
  });
}

export function initDirMenuWiring(): void {
  setDirMenuHandlers({
    defaultLocalProfile: () => tabManager.defaultLocalProfile(),
    createLocalTab: (command, label, cwd) => tabManager.createLocalTab(command, label, cwd),
  });
}

export function initSshAuthWiring(): void {
  setSshAuthTabLookup((sessionId) => {
    if (!sessionId) return undefined;
    const t = tabManager.get(sessionId);
    if (t && t.type === "ssh" && t.sshEmbedded) return t;
    return undefined;
  });
}
