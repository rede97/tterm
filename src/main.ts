import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getVersion } from "@tauri-apps/api/app";
import { createElement, Cog } from "lucide";
import "@xterm/xterm/css/xterm.css";
import "@fontsource/jetbrains-mono";
import "@fontsource/fira-mono";
import "@fontsource/cascadia-mono";
import "@fontsource/source-code-pro";
import "@fontsource/ibm-plex-mono";
import "@fontsource/roboto-mono";
import "@fontsource/ubuntu-mono";
import "./assets/fonts/nerd-fonts.css";
import { parseFontFamily, updateFontStack, setSystemFonts } from "./util/fontconfig";
import { tabManager, initTabManager } from "./terminal/tabmanager";
import { initSearchBar } from "./terminal/search";
import { initProfileMenu } from "./terminal/profilemenu";
import { initSshAuthDialogs } from "./terminal/sshauth";
import { initWindowControls } from "./ui/window";
import { configStore } from "./core/store";
import { loadSshHosts } from "./config/ssh-config";
import { loadAllWtData } from "./config/wt-profiles";
import { setWtThemes, findTheme, applyTerminalBackground } from "./util/themes";
import { loadCustomThemes } from "./config/custom-themes";
import { loadSerialProfiles } from "./config/serial-profiles";
import { logCatch } from "./core/errorlog";
import { scheduleAutoUpdateCheck } from "./core/updater";

// -- DOM refs ---

const terminalContainer = document.getElementById("terminal-container")!;
const tabsContainer = document.getElementById("tabs")!;

// scroll wheel on tab bar ->horizontal scroll
tabsContainer.addEventListener("wheel", (e) => {
  if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
    tabsContainer.scrollLeft += e.deltaY;
  }
}, { passive: true });

// block all browser native context menus
document.addEventListener("contextmenu", e => e.preventDefault());


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
  if (keys.some(k => ["fontFamily", "fontSize", "scrollback", "themeName"].includes(k))) {
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
  }
});

// -- init feature modules --

// Debug/E2E introspection hook (dev builds only).
// NOTE: tabs must be a getter — _syncTabOrderFromDom reassigns the Map on
// drag reorder, a captured reference would go stale.
if (import.meta.env.DEV) {
  (window as any).__tterm = { get tabs() { return tabManager.tabs; }, mgr: tabManager };
  import("./util/imebox").then(m => {
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
import("./terminal/quickpanel").then(m => {
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
import("./terminal/contextmenu").then(m => {
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
    pasteToTab: (id, text) => tabManager.get(id)?.terminal.paste(text),
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
listen<{ id: string; req: number; format?: string; scale?: number }>("share-screen-request", (e) => {
  const respond = (snapshot: unknown) =>
    invoke("share_screen_response", { req: e.payload.req, snapshot }).catch(logCatch("share.screenResponse"));
  const tab = tabManager.get(e.payload.id);
  if (!tab) {
    respond({ error: "session has no terminal" });
  } else if (e.payload.format === "png") {
    tab.buildShareScreenshot(e.payload.scale ?? 2).then(respond);
  } else {
    respond(tab.buildShareSnapshot());
  }
});
initWindowControls();

// Flush pending debounced config writes before the window closes.
window.addEventListener("beforeunload", () => configStore.flush());

// -- initial tab --

getVersion().then(v => { welcomeVersion.textContent = "v" + v; }).catch(logCatch("app.version"));

// Load SSH hosts and store in config
loadSshHosts().then(hosts => {
  configStore.set({ sshHosts: hosts });
}).catch(logCatch("ssh.loadHosts"));

// Load system fonts in background (non-blocking)
invoke<string[]>("list_system_fonts").then(fonts => {
  setSystemFonts(fonts);
}).catch(logCatch("font.listSystem"));

// Load config, then profiles, then open initial tab
configStore.load().then(async () => {
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
}).catch(() => {
  welcomeEl.style.display = "flex";
});

// Check for updates in the background (no-op in dev builds without a signed release;
// skipped when disabled in Settings → General → Updates)
scheduleAutoUpdateCheck();
