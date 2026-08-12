import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Cog, createElement } from "lucide";
import "@xterm/xterm/css/xterm.css";
import "@fontsource/jetbrains-mono";
import "@fontsource/fira-mono";
import "@fontsource/cascadia-mono";
import "@fontsource/source-code-pro";
import "@fontsource/ibm-plex-mono";
import "@fontsource/roboto-mono";
import "@fontsource/ubuntu-mono";
import "./assets/fonts/nerd-fonts.css";
import { loadCustomThemes } from "./config/custom-themes";
import { loadSerialProfiles } from "./config/serial-profiles";
import { loadSshHosts } from "./config/ssh-config";
import { loadAllWtData } from "./config/wt-profiles";
import { logCatch, logError, swallow } from "./core/errorlog";
import { initKeymap } from "./core/keymap";
import { configStore } from "./core/store";
import { scheduleAutoUpdateCheck } from "./core/updater";
import { pasteIntoTerminal } from "./terminal/paste";
import { initProfileMenu } from "./terminal/profilemenu";
import { initSearchBar } from "./terminal/search";
import { initSshAuthDialogs } from "./terminal/sshauth";
import type { TerminalTab } from "./terminal/tab";
import { initTabManager, tabManager } from "./terminal/tabmanager";
import { openQuickOpen, setTabSwitcherHandlers, stepMruSwitcher } from "./ui/tabswitcher";
import { showToast } from "./ui/toast";
import { initWindowControls, toggleFullscreenMode, toggleZenMode } from "./ui/window";
import { parseFontFamily, setSystemFonts, updateFontStack } from "./util/fontconfig";
import { applyTerminalBackground, findTheme, setWtThemes } from "./util/themes";

// -- DOM refs ---

const terminalContainer = document.getElementById("terminal-container")!;
const tabsContainer = document.getElementById("tabs")!;

// scroll wheel on tab bar ->horizontal scroll
tabsContainer.addEventListener(
  "wheel",
  (e) => {
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      tabsContainer.scrollLeft += e.deltaY;
    }
  },
  { passive: true },
);

// block all browser native context menus
document.addEventListener("contextmenu", (e) => e.preventDefault());

// -- welcome screen --

const welcomeEl = document.createElement("div");
welcomeEl.id = "welcome";
welcomeEl.style.display = "none";
terminalContainer.appendChild(welcomeEl);

const welcomeTitle = document.createElement("div");
welcomeTitle.className = "welcome-title";
welcomeTitle.textContent = "TTerm";
welcomeEl.appendChild(welcomeTitle);

const welcomeVersion = document.createElement("div");
welcomeVersion.className = "welcome-version";
welcomeEl.appendChild(welcomeVersion);

// -- init TabManager ---

initTabManager(tabsContainer, terminalContainer, welcomeEl);

// -- settings --

tabManager.setSettingsFactory(async () => {
  const m = await import("./settings/index");
  return m.createSettingsContent();
});

const settingsBtn = document.getElementById("settings-btn")!;
settingsBtn.appendChild(createElement(Cog, { stroke: "currentColor", width: 16, height: 16 }));
settingsBtn.addEventListener("click", () => {
  tabManager.toggleSettings();
});

// Subscribe to config changes — update all open terminals when relevant keys change
configStore.subscribe((keys) => {
  if (keys.some((k) => ["fontFamily", "fontSize", "scrollback", "themeName"].includes(k))) {
    const theme = findTheme(configStore.get("themeName")).theme;
    // The whole terminal chrome (active tab, container frame, xterm edge
    // strips) follows the theme background via one CSS variable.
    applyTerminalBackground(theme);
    for (const tab of tabManager.tabs.values()) {
      tab.terminal.options.fontFamily = configStore.get("fontFamily");
      tab.terminal.options.fontSize = configStore.get("fontSize");
      tab.terminal.options.scrollback = configStore.get("scrollback");
      tab.terminal.options.theme = theme;
    }
    tabManager.triggerResize();
    // A newly chosen webfont family loads lazily: the fit above can measure
    // fallback metrics and leave the grid oversized (bottom clipped) once
    // the real glyphs arrive. Load the primary family explicitly, then refit.
    const primary = configStore
      .get("fontFamily")
      .split(",")[0]
      ?.trim()
      .replace(/^["']|["']$/g, "");
    if (primary) {
      document.fonts
        .load(`${configStore.get("fontSize")}px "${primary}"`)
        .then(() => tabManager.triggerResize())
        .catch(swallow);
    }
  }
});

// -- init feature modules --

// Debug/E2E introspection hook (dev builds only).
// NOTE: tabs must be a getter — _syncTabOrderFromDom reassigns the Map on
// drag reorder, a captured reference would go stale.
if (import.meta.env.DEV) {
  (window as any).__tterm = {
    get tabs() {
      return tabManager.tabs;
    },
    mgr: tabManager,
    config: configStore,
  };
  import("./util/imebox").then((m) => {
    (window as any).__tterm.setImeMirrorMode = (mode: "auto" | "always" | "off") => {
      m.setImeMirrorMode(mode);
      for (const t of tabManager.tabs.values()) t.refreshImeClasses();
    };
    (window as any).__tterm.getImeMirrorMode = m.getImeMirrorMode;
    // M2 diagnostics: composition lifecycle tracer + bisection flags
    (window as any).__tterm.imeTrace = (on: boolean) => m.setImeTrace(on);
    (window as any).__tterm.imeDebug = (f: { suppress?: boolean; reanchor?: boolean }) => {
      m.setImeDebugFlags(f);
      for (const t of tabManager.tabs.values()) t.refreshImeClasses();
    };
  });
}

tabManager.initNewTabButton();
initSearchBar();
initProfileMenu();
initSshAuthDialogs();

// Keyboard shortcuts: global dispatcher (core/keymap) + tab switcher overlay.
// Commands are rebindable in Settings → Keyboard.
{
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

// AI session sharing: the hub asks the frontend for a screen snapshot —
// the xterm buffer is the ground-truth character grid.
listen<{ id: string; req: number; format?: string; scale?: number }>(
  "share-screen-request",
  (e) => {
    const respond = (snapshot: unknown) =>
      invoke("share_screen_response", { req: e.payload.req, snapshot }).catch(
        logCatch("share.screenResponse"),
      );
    const tab = tabManager.get(e.payload.id);
    if (!tab) {
      respond({ error: "session has no terminal" });
    } else if (e.payload.format === "png") {
      tab.buildShareScreenshot(e.payload.scale ?? 2).then(respond);
    } else {
      respond(tab.buildShareSnapshot());
    }
  },
);
initWindowControls();

// Flush pending debounced config writes before the window closes.
window.addEventListener("beforeunload", () => configStore.flush());

// -- initial tab --

getVersion()
  .then((v) => {
    welcomeVersion.textContent = `v${v}`;
  })
  .catch(logCatch("app.version"));

// Load SSH hosts and store in config
loadSshHosts()
  .then((hosts) => {
    configStore.set({ sshHosts: hosts });
  })
  .catch(logCatch("ssh.loadHosts"));

// Load system fonts in background (non-blocking)
invoke<string[]>("list_system_fonts")
  .then((fonts) => {
    setSystemFonts(fonts);
  })
  .catch(logCatch("font.listSystem"));

// Load config, then profiles, then open initial tab
configStore
  .load()
  .then(async () => {
    updateFontStack(parseFontFamily(configStore.get("fontFamily")));
    // Terminal chrome background tracks the active theme from the start.
    applyTerminalBackground(findTheme(configStore.get("themeName")).theme);

    // Load WT profiles + VS installs + themes, plus user custom themes
    // (themes.json — separate from config.json by design).
    const wt = await loadAllWtData();
    setWtThemes(wt.themes);
    await loadCustomThemes();
    await loadSerialProfiles();
    configStore.set({
      localProfiles: wt.profiles,
      vsInstalls: wt.vsInstalls,
    });

    const p = tabManager.defaultLocalProfile();
    if (p) await tabManager.createLocalTab(p.command, p.name);
    else await tabManager.createLocalTab();
  })
  .catch((e) => {
    // load() never rejects — this is a downstream failure (WT data, themes,
    // first tab). Surface it instead of a bare welcome screen.
    logError("app.init", e);
    showToast(`Startup failed: ${e}`, "error");
    welcomeEl.style.display = "flex";
  });

// Check for updates in the background (no-op in dev builds without a signed release;
// skipped when disabled in Settings → General → Updates)
scheduleAutoUpdateCheck();
