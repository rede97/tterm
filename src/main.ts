import { listen } from "@tauri-apps/api/event";
import { getVersion } from "@tauri-apps/api/app";
import { createElement, Cog } from "lucide";
import "@xterm/xterm/css/xterm.css";
import "@fontsource/jetbrains-mono";
import { PtyOutputPayload } from "./types";
import { appState } from "./state";
import { showSizeHint, applyFit } from "./terminal";
import { createTab, createCustomTab, initNewTabButton } from "./tabs";
import { initSearchBar } from "./search";
import { initProfileMenu } from "./profilemenu";
import { initContextMenu } from "./contextmenu";
import { initWindowControls, restoreWindowState } from "./window";
import { createSettingsContent, setOnSettingsChanged } from "./settings";
import {
  localProfiles, defaultLocalProfile,
  loadSshHosts, loadLocalProfiles, loadConfig,
  configFontFamily, configFontSize,
} from "./profiles";
import { invoke } from "@tauri-apps/api/core";

// ── DOM refs ──────────────────────────────────────────────────────

const terminalContainer = document.getElementById("terminal-container")!;
const tabsContainer = document.getElementById("tabs")!;

// scroll — wheel on tab bar → horizontal scroll
tabsContainer.addEventListener("wheel", (e) => {
  if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
    tabsContainer.scrollLeft += e.deltaY;
  }
}, { passive: true });

// ── size hint overlay ──────────────────────────────────────────────

const sizeOverlay = document.createElement("div");
sizeOverlay.id = "size-overlay";
terminalContainer.appendChild(sizeOverlay);

// ── welcome screen ─────────────────────────────────────────────────

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

// ── PTY output routing ─────────────────────────────────────────────

listen<PtyOutputPayload>("pty-output", (event) => {
  const { id, data } = event.payload;
  const tab = appState.tabs.get(id);
  if (tab) {
    tab.terminal.write(new Uint8Array(data));
  }
});

// ── window resize ──────────────────────────────────────────────────

let resizeTimer: ReturnType<typeof setTimeout> | null = null;

window.addEventListener("resize", () => {
  for (const t of appState.tabs.values()) t.needsResize = true;

  if (appState.activeTabId === null) return;
  const tab = appState.tabs.get(appState.activeTabId);
  if (!tab) return;

  const { cols, rows } = applyFit(tab);
  tab.needsResize = false;
  const cw = tab.xtermEl.clientWidth / cols;
  const ch = tab.xtermEl.clientHeight / rows;
  if (cw > 0) tab.charWidth = cw;
  if (ch > 0) tab.charHeight = ch;
  showSizeHint(cols, rows);

  const tabId = tab.id;
  if (resizeTimer) clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    resizeTimer = null;
    const t = appState.tabs.get(tabId);
    if (t) {
      invoke("pty_resize", { id: t.id, cols: t.terminal.cols, rows: t.terminal.rows });
    }
  }, 250);
});

// ── settings ───────────────────────────────────────────────────────

let settingsEl: HTMLElement | null = null;
let settingsTabEl: HTMLElement | null = null;

function openSettings() {
  if (settingsEl) return;

  for (const tab of appState.tabs.values()) {
    tab.element.style.display = "none";
    tab.tabElement.classList.remove("active");
  }

  if (!settingsTabEl) {
    settingsTabEl = document.createElement("div");
    settingsTabEl.className = "tab active";
    const label = document.createElement("span");
    label.className = "tab-label";
    label.textContent = "Settings";
    settingsTabEl.appendChild(label);
    const closeBtn = document.createElement("button");
    closeBtn.className = "tab-close";
    closeBtn.style.opacity = "1";
    closeBtn.textContent = "\xd7";
    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      closeSettings();
    });
    settingsTabEl.appendChild(closeBtn);
    tabsContainer.insertBefore(settingsTabEl, tabsContainer.firstChild);
  }
  settingsTabEl.classList.add("active");

  settingsEl = createSettingsContent();
  terminalContainer.appendChild(settingsEl);
}

function closeSettings() {
  if (settingsEl) {
    settingsEl.remove();
    settingsEl = null;
  }
  if (settingsTabEl) {
    settingsTabEl.classList.remove("active");
    settingsTabEl.remove();
    settingsTabEl = null;
  }
  if (appState.activeTabId) {
    const tab = appState.tabs.get(appState.activeTabId);
    if (tab) {
      tab.element.style.display = "";
      tab.tabElement.classList.add("active");
      tab.terminal.focus();
    }
  } else {
    welcomeEl.style.display = "flex";
  }
}

const settingsBtn = document.getElementById("settings-btn")!;
settingsBtn.appendChild(createElement(Cog, { stroke: "currentColor", width: 16, height: 16 }));
settingsBtn.addEventListener("click", () => {
  if (settingsEl) closeSettings();
  else openSettings();
});

setOnSettingsChanged(async () => {
  await loadLocalProfiles();
  for (const tab of appState.tabs.values()) {
    tab.terminal.options.fontFamily = configFontFamily;
    tab.terminal.options.fontSize = configFontSize;
  }
});

// ── init feature modules ───────────────────────────────────────────

initNewTabButton();
initSearchBar();
initProfileMenu();
initContextMenu();
initWindowControls();

// ── initial tab ────────────────────────────────────────────────────

getVersion().then(v => { welcomeVersion.textContent = "v" + v; }).catch(() => {});

loadSshHosts();
loadConfig().then(() => {
  restoreWindowState();
  return loadLocalProfiles();
}).then(() => {
  const defName = defaultLocalProfile ?? localProfiles[0]?.name ?? null;
  const p = defName ? localProfiles.find(x => x.name === defName) : null;
  if (p) createCustomTab(p.command, p.name);
  else createTab();
}).catch(() => {
  welcomeEl.style.display = "flex";
});
