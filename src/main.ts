import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Cog, createElement } from "lucide";
import { DOM_ID } from "./core/dom-ids";
import "@xterm/xterm/css/xterm.css";
import "@fontsource/jetbrains-mono";
import "@fontsource/fira-mono";
import "@fontsource/cascadia-mono";
import "@fontsource/source-code-pro";
import "@fontsource/ibm-plex-mono";
import "@fontsource/roboto-mono";
import "@fontsource/ubuntu-mono";
import { loadCustomThemes } from "./config/custom-themes";
import { loadSerialProfiles } from "./config/serial-profiles";
import { loadSshHosts } from "./config/ssh-config";
import { loadAllWtData } from "./config/wt-profiles";
import { logCatch, logError, swallow } from "./core/errorlog";
import "./core/devhooks";
import { configStore } from "./core/store";
import { scheduleAutoUpdateCheck } from "./core/updater";
import { initProfileMenu } from "./terminal/profilemenu";
import { initSearchBar } from "./terminal/search";
import { applyShareControl, buildShareState } from "./terminal/sharecontrol";
import { readShareLines, type ShareLinesQuery } from "./terminal/sharelines";
import { initSshAuthDialogs } from "./terminal/sshauth";
import { initTabManager, tabManager } from "./terminal/tabmanager";
import { mustGetById } from "./ui/dom";
import { showToast } from "./ui/toast";
import { initWindowControls } from "./ui/window";
import { parseFontFamily, setSystemFonts, updateFontStack } from "./util/fontconfig";
import { applyTerminalBackground, findTheme, setWtThemes } from "./util/themes";
import {
  initContextMenuWiring,
  initDirMenuWiring,
  initQuickPanelWiring,
  initSearchWiring,
  initShortcutsWiring,
  initSshAuthWiring,
  initWindowCloseConfirm,
} from "./wiring";

// -- DOM refs ---

const terminalContainer = mustGetById(DOM_ID.terminalContainer);
const tabsContainer = mustGetById(DOM_ID.tabs);

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

// -- welcome backdrop --
// Permanent background layer: terminal instances and the settings page
// cover it with opaque backgrounds (z-index, see styles.css). No show/hide
// state exists anywhere — "no tabs" simply uncovers it.

const welcomeEl = document.createElement("div");
welcomeEl.id = "welcome";
terminalContainer.appendChild(welcomeEl);

const welcomeTitle = document.createElement("div");
welcomeTitle.className = "welcome-title";
welcomeTitle.textContent = "TTerm";
welcomeEl.appendChild(welcomeTitle);

const welcomeVersion = document.createElement("div");
welcomeVersion.className = "welcome-version";
welcomeEl.appendChild(welcomeVersion);

// -- init TabManager ---

initTabManager(tabsContainer, terminalContainer);

// -- settings --

tabManager.setSettingsFactory(async () => {
  const m = await import("./settings/index");
  return m.createSettingsContent();
});

/** Apply chrome skin + quick-panel glass to <body>. Skin drives Settings /
 *  menus / quick panel via --tt-* tokens; the tab bar stays fixed dark and
 *  terminal schemes stay independent (see src/ui/tokens.css). */
function applyChromeSkin(): void {
  document.body.dataset.skin = configStore.get("chromeSkin");
  document.body.classList.toggle("qp-glass", configStore.get("quickPanelGlass"));
}

// Skin defaults to Cursor Mono before config resolves; load() re-applies.
applyChromeSkin();

const settingsBtn = mustGetById(DOM_ID.settingsBtn);
settingsBtn.appendChild(createElement(Cog, { stroke: "currentColor", width: 16, height: 16 }));
settingsBtn.addEventListener("click", () => {
  tabManager.toggleSettings();
});

// Subscribe to config changes — update all open terminals when relevant keys change
configStore.subscribe((keys) => {
  if (keys.includes("chromeSkin") || keys.includes("quickPanelGlass")) {
    applyChromeSkin();
  }
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

// Debug/E2E introspection hook (dev builds only). Typed in core/devhooks.ts.
if (import.meta.env.DEV) {
  window.__tterm = {
    get tabs() {
      return tabManager.tabs;
    },
    mgr: tabManager,
    config: configStore,
  };
  import("./util/imebox").then((m) => {
    if (!window.__tterm) return;
    window.__tterm.setImeMirrorMode = (mode: "auto" | "always" | "off") => {
      m.setImeMirrorMode(mode);
      for (const t of tabManager.tabs.values()) t.refreshImeClasses();
    };
    window.__tterm.getImeMirrorMode = m.getImeMirrorMode;
    // M2 diagnostics: composition lifecycle tracer + bisection flags
    window.__tterm.imeTrace = (on: boolean) => m.setImeTrace(on);
    window.__tterm.imeDebug = (f: { suppress?: boolean; reanchor?: boolean }) => {
      m.setImeDebugFlags(f);
      for (const t of tabManager.tabs.values()) t.refreshImeClasses();
    };
  });
}

tabManager.initNewTabButton();
initSearchBar();
initProfileMenu();
initSshAuthDialogs();
initSshAuthWiring();

// Feature wiring lives in ./wiring (composition root for handler injection).
initShortcutsWiring();
initQuickPanelWiring();
initContextMenuWiring();
initSearchWiring();
initDirMenuWiring();
initWindowCloseConfirm();

// AI session sharing: the hub asks the frontend for a screen snapshot —
// the xterm buffer is the ground-truth character grid.
listen<{
  id: string;
  req: number;
  format?: string;
  scale?: number;
  lines?: ShareLinesQuery;
  state?: boolean;
  control?: unknown;
}>("share-screen-request", (e) => {
  const respond = (snapshot: unknown) =>
    invoke("share_screen_response", { req: e.payload.req, snapshot }).catch(
      logCatch("share.screenResponse"),
    );
  const tab = tabManager.get(e.payload.id);
  if (!tab) {
    respond({ error: "session has no terminal" });
  } else if (e.payload.lines) {
    respond(readShareLines(tab.terminal, e.payload.lines));
  } else if (e.payload.state) {
    buildShareState(tab).then(respond);
  } else if (e.payload.control !== undefined) {
    applyShareControl(tab, e.payload.control as never).then(respond);
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
    applyChromeSkin();
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
