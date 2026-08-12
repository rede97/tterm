// Composition root for handler injection.
//
// Feature modules (quickpanel / contextmenu / keymap / tabswitcher) never
// import TabManager — main-adjacent WIRING binds their handler slots to the
// manager here, keeping the module graph acyclic. main.ts calls these three
// functions at startup instead of carrying the inline blocks.

import { invoke } from "@tauri-apps/api/core";
import { logCatch } from "./core/errorlog";
import { initKeymap } from "./core/keymap";
import { pasteIntoTerminal } from "./terminal/paste";
import type { TerminalTab } from "./terminal/tab";
import { tabManager } from "./terminal/tabmanager";
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
        return tabManager.mruTabIds().map((id) => {
          const i = entries.findIndex(([eid]) => eid === id);
          return toItem([id, byId.get(id)!], i);
        });
      }
      return entries.map((e, i) => toItem(e, i));
    },
    switchTo: (id) => tabManager.switchTo(id),
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
      isEmbeddedSshTab: (id) => {
        const t = tabManager.get(id);
        return !!t && t.type === "ssh" && t.sshEmbedded === true;
      },
    });
    m.initContextMenu();
  });
}
