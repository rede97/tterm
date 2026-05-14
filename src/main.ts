import { listen } from "@tauri-apps/api/event";
import { getVersion } from "@tauri-apps/api/app";
import { createElement, Cog } from "lucide";
import "@xterm/xterm/css/xterm.css";
import "@fontsource/jetbrains-mono";
import { PtyOutputPayload } from "./types";
import { tabManager, initTabManager } from "./tabmanager";
import { initSearchBar } from "./search";
import { initProfileMenu } from "./profilemenu";
import { initContextMenu } from "./contextmenu";
import { initWindowControls } from "./window";
import { createSettingsContent, setOnSettingsChanged } from "./settings";
import {
  localProfiles, defaultLocalProfile,
  loadSshHosts, loadLocalProfiles, loadConfig,
  configFontFamily, configFontSize,
} from "./profiles";

// ── DOM refs ──────────────────────────────────────────────────────

const terminalContainer = document.getElementById("terminal-container")!;
const tabsContainer = document.getElementById("tabs")!;

// scroll — wheel on tab bar → horizontal scroll
tabsContainer.addEventListener("wheel", (e) => {
  if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
    tabsContainer.scrollLeft += e.deltaY;
  }
}, { passive: true });

// block all browser native context menus
document.addEventListener("contextmenu", e => e.preventDefault());


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

// ── init TabManager ────────────────────────────────────────────────

initTabManager(tabsContainer, terminalContainer, welcomeEl);

// ── PTY output routing ─────────────────────────────────────────────

listen<PtyOutputPayload>("pty-output", (event) => {
  const { id, data } = event.payload;
  const tab = tabManager.get(id);
  if (tab) {
    tab.terminal.write(new Uint8Array(data));
  }
});

// ── settings ───────────────────────────────────────────────────────

tabManager.setSettingsFactory(createSettingsContent);

const settingsBtn = document.getElementById("settings-btn")!;
settingsBtn.appendChild(createElement(Cog, { stroke: "currentColor", width: 16, height: 16 }));
settingsBtn.addEventListener("click", () => {
  tabManager.toggleSettings();
});

setOnSettingsChanged(async () => {
  await loadLocalProfiles();
  for (const tab of tabManager.tabs.values()) {
    tab.terminal.options.fontFamily = configFontFamily;
    tab.terminal.options.fontSize = configFontSize;
  }
});

// ── init feature modules ───────────────────────────────────────────

tabManager.initNewTabButton();
initSearchBar();
initProfileMenu();
initContextMenu();
initWindowControls();

// ── initial tab ────────────────────────────────────────────────────

getVersion().then(v => { welcomeVersion.textContent = "v" + v; }).catch(() => {});

loadSshHosts();
loadConfig().then(() => {
  return loadLocalProfiles();
}).then(async () => {
  const defName = defaultLocalProfile ?? localProfiles[0]?.name ?? null;
  const p = defName ? localProfiles.find(x => x.name === defName) : null;
  if (p) await tabManager.createLocalTab(p.command, p.name);
  else await tabManager.createLocalTab();
}).catch(() => {
  welcomeEl.style.display = "flex";
});
