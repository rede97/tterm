import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
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
import { parseFontFamily, updateFontStack, setSystemFonts } from "./fontconfig";
import { PtyOutputPayload } from "./types";
import { tabManager, initTabManager } from "./tabmanager";
import { initSearchBar } from "./search";
import { initProfileMenu } from "./profilemenu";
import { initWindowControls } from "./window";
import { setOnSettingsChanged } from "./settings-events";
import {
  localProfiles, defaultLocalProfile,
  loadSshHosts, loadLocalProfiles, loadConfig,
  configFontFamily, configFontSize, configScrollback,
  configTabWidthMode,
} from "./profiles";

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

// -- PTY output routing ---
// data arrives as base64-encoded bytes.  Batching is handled on the Rust
// side (11ms coalescing window), so here we just decode and write directly.

function _b64decode(b64: string): Uint8Array {
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

listen<PtyOutputPayload>("pty-output", (event) => {
  const { id, data } = event.payload;
  const tab = tabManager.get(id);
  if (tab) {
    tab.terminal.write(_b64decode(data));
  }
});

// -- settings --

tabManager.setSettingsFactory(async () => {
  const m = await import("./settings");
  return m.createSettingsContent();
});

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
    tab.terminal.options.scrollback = configScrollback;
  }
  applyTabWidthMode();
  tabManager.triggerResize();
});

function applyTabWidthMode(): void {
  if (configTabWidthMode === "equal") {
    tabsContainer.classList.add("tabs-equal");
    tabsContainer.classList.remove("tabs-adaptive");
  } else {
    tabsContainer.classList.add("tabs-adaptive");
    tabsContainer.classList.remove("tabs-equal");
  }
}

// -- init feature modules --

tabManager.initNewTabButton();
initSearchBar();
initProfileMenu();
import("./contextmenu").then(m => m.initContextMenu());
initWindowControls();

// -- initial tab --

getVersion().then(v => { welcomeVersion.textContent = "v" + v; }).catch(() => {});

loadSshHosts();

// Load system fonts in background (non-blocking)
invoke<string[]>("list_system_fonts").then(fonts => {
  setSystemFonts(fonts);
}).catch(() => {});

loadConfig().then(() => {
  updateFontStack(parseFontFamily(configFontFamily));
  return loadLocalProfiles();
}).then(async () => {
  applyTabWidthMode();
  const defName = defaultLocalProfile ?? localProfiles[0]?.name ?? null;
  const p = defName ? localProfiles.find(x => x.name === defName) : null;
  if (p) await tabManager.createLocalTab(p.command, p.name);
  else await tabManager.createLocalTab();
}).catch(() => {
  welcomeEl.style.display = "flex";
});


