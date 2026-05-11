import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { createElement, Minus, Square, Copy, X, Terminal as TerminalIcon, Globe } from "lucide";
import "@xterm/xterm/css/xterm.css";

interface PtyOutputPayload {
  id: string;
  data: number[];
}

interface SshHost {
  name: string;
  hostname: string;
  port: number;
  user: string;
}

interface LocalProfile {
  name: string;
  command: string;
}

interface VsInstallation {
  path: string;
  version: string;
  instance_id?: string | null;
}

let sshHosts: SshHost[] = [];
let localProfiles: LocalProfile[] = [];
let vsInstalls: VsInstallation[] = [];
let defaultLocalProfile: string | null = null;

interface Tab {
  id: string;
  terminal: Terminal;
  fitAddon: FitAddon;
  element: HTMLElement;
  tabElement: HTMLElement;
  xtermEl: HTMLElement;
  charWidth: number;
  charHeight: number;
}

const tabs: Map<string, Tab> = new Map();
let activeTabId: string | null = null;

const terminalContainer = document.getElementById("terminal-container")!;
const tabsContainer = document.getElementById("tabs")!;
const newTabButton = document.getElementById("new-tab")!;

// wheel → horizontal scroll on tab bar (no Shift needed)
tabsContainer.addEventListener("wheel", (e) => {
  if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
    tabsContainer.scrollLeft += e.deltaY;
  }
}, { passive: true });

// ── size hint overlay ──────────────────────────────────────────────

const sizeOverlay = document.createElement("div");
sizeOverlay.id = "size-overlay";
terminalContainer.appendChild(sizeOverlay);

let sizeHintTimer: ReturnType<typeof setTimeout> | null = null;

function showSizeHint(cols: number, rows: number) {
  sizeOverlay.textContent = `${cols} \xd7 ${rows}`;
  sizeOverlay.classList.add("visible");
  if (sizeHintTimer) clearTimeout(sizeHintTimer);
  sizeHintTimer = setTimeout(() => {
    sizeOverlay.classList.remove("visible");
  }, 1200);
}

function applyFit(tab: Tab): { cols: number; rows: number } {
  const addon = tab.fitAddon as any;
  const proposed: { cols: number; rows: number } | undefined = addon.proposeDimensions?.();
  if (!proposed) {
    tab.fitAddon.fit();
    return { cols: tab.terminal.cols, rows: tab.terminal.rows };
  }

  const core = (tab.terminal as any)._core;
  const dims = core._renderService.dimensions;
  if (!dims || dims.css.cell.width === 0 || dims.css.cell.height === 0) {
    return { cols: tab.terminal.cols, rows: tab.terminal.rows };
  }

  const charH = dims.css.cell.height;
  const charW = dims.css.cell.width;
  const toleranceV = Math.max(1, Math.round(charH * 0.1));
  const toleranceH = Math.max(1, Math.round(charW * 0.1));

  // available area — same calc as fit addon uses internally
  const parent = tab.terminal.element!.parentElement!;
  const parentStyle = getComputedStyle(parent);
  const parentH = parseFloat(parentStyle.getPropertyValue("height"));
  const xtermStyle = getComputedStyle(tab.terminal.element!);
  const paddingV =
    parseFloat(xtermStyle.paddingTop) + parseFloat(xtermStyle.paddingBottom);
  const paddingH =
    parseFloat(xtermStyle.paddingLeft) + parseFloat(xtermStyle.paddingRight);
  const availableH = parentH - paddingV;
  const availableW =
    parseFloat(parentStyle.getPropertyValue("width")) - paddingH;

  // proposed.rows = floor(availableH / charH) — always fits
  let rows = proposed.rows;
  if (tab.terminal.rows > proposed.rows) {
    const overflow = tab.terminal.rows * charH - availableH;
    if (overflow > 0 && overflow <= toleranceV) rows = tab.terminal.rows;
  }

  let cols = Math.max(2, proposed.cols);
  if (tab.terminal.cols > proposed.cols) {
    const overflow = tab.terminal.cols * charW - availableW;
    if (overflow > 0 && overflow <= toleranceH) cols = tab.terminal.cols;
  }

  if (tab.terminal.rows !== rows || tab.terminal.cols !== cols)
    tab.terminal.resize(cols, rows);

  return { cols, rows };
}

// ── terminal factory ───────────────────────────────────────────────

function createTerminal(): {
  terminal: Terminal;
  fitAddon: FitAddon;
  element: HTMLElement;
  xtermEl: HTMLElement;
} {
  const element = document.createElement("div");
  element.className = "terminal-instance";
  element.style.display = "none";
  terminalContainer.appendChild(element);

  const terminal = new Terminal({
    cursorBlink: true,
    fontSize: 14,
    fontFamily: 'Consolas, "Courier New", monospace',
    theme: {
      background: "#1e1e1e",
      foreground: "#d4d4d4",
      cursor: "#ffffff",
      selectionBackground: "#264f78",
      black: "#000000",
      red: "#cd3131",
      green: "#0dbc79",
      yellow: "#e5e510",
      blue: "#2472c8",
      magenta: "#bc3fbc",
      cyan: "#11a8cd",
      white: "#e5e5e5",
      brightBlack: "#666666",
      brightRed: "#f14c4c",
      brightGreen: "#23d18b",
      brightYellow: "#f5f543",
      brightBlue: "#3b8eea",
      brightMagenta: "#d670d6",
      brightCyan: "#29b8db",
      brightWhite: "#ffffff",
    },
  });

  const fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.open(element);

  return {
    terminal,
    fitAddon,
    element,
    xtermEl: element.querySelector(".xterm") as HTMLElement,
  };
}

// ── tab bar UI ─────────────────────────────────────────────────────

function createTabElement(id: string): HTMLElement {
  const tab = document.createElement("div");
  tab.className = "tab";
  tab.dataset.tabId = id;
  tab.setAttribute("data-tauri-drag-region", "");

  const label = document.createElement("span");
  label.className = "tab-label";
  label.textContent = "Terminal";

  const closeBtn = document.createElement("button");
  closeBtn.className = "tab-close";
  closeBtn.textContent = "\xd7";
  closeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    closeTab(id);
  });

  tab.appendChild(label);
  tab.appendChild(closeBtn);

  tab.addEventListener("click", () => {
    switchTab(id);
  });

  return tab;
}

function switchTab(id: string): void {
  if (activeTabId === id) return;

  if (activeTabId !== null) {
    const current = tabs.get(activeTabId);
    if (current) {
      current.element.style.display = "none";
      current.tabElement.classList.remove("active");
    }
  }

  const tab = tabs.get(id);
  if (tab) {
    tab.element.style.display = "";
    tab.tabElement.classList.add("active");
    applyFit(tab); // fit grid only, no IPC
    tab.terminal.focus();
    activeTabId = id;
  }
}

async function closeTab(id: string): Promise<void> {
  const tab = tabs.get(id);
  if (!tab) return;

  await invoke("pty_kill", { id });

  tab.element.remove();
  tab.tabElement.remove();
  tabs.delete(id);

  if (activeTabId === id) {
    const remaining = Array.from(tabs.keys());
    if (remaining.length > 0) {
      switchTab(remaining[remaining.length - 1]);
    } else {
      activeTabId = null;
    }
  }
}

function setupTab(id: string, label: string): void {
  const { terminal, fitAddon, element, xtermEl } = createTerminal();
  const tabElement = createTabElement(id);
  (tabElement.querySelector(".tab-label") as HTMLElement).textContent = label;

  terminal.onData((data) => {
    invoke("pty_write", { id, data });
  });

  tabsContainer.appendChild(tabElement);

  tabs.set(id, {
    id,
    terminal,
    fitAddon,
    element,
    tabElement,
    xtermEl,
    charWidth: 0,
    charHeight: 0,
  });

  switchTab(id);
}

async function createTab(): Promise<void> {
  const id: string = await invoke("pty_spawn");
  setupTab(id, "Terminal");
}

async function createSshTab(host: SshHost): Promise<void> {
  const id: string = await invoke("pty_spawn_ssh", {
    hostname: host.hostname,
    port: host.port,
    user: host.user,
  });
  setupTab(id, host.name);
}

async function createCustomTab(command: string, label: string): Promise<void> {
  const id: string = await invoke("pty_spawn", { command });
  setupTab(id, label);
}

// ── PTY output routing ─────────────────────────────────────────────

listen<PtyOutputPayload>("pty-output", (event) => {
  const { id, data } = event.payload;
  const tab = tabs.get(id);
  if (tab) {
    tab.terminal.write(new Uint8Array(data));
  }
});

// ── window resize: fit grid immediately, defer PTY resize ──────────

let resizeTimer: ReturnType<typeof setTimeout> | null = null;

window.addEventListener("resize", () => {
  if (activeTabId === null) return;
  const tab = tabs.get(activeTabId);
  if (!tab) return;

  const { cols, rows } = applyFit(tab);
  const cw = tab.xtermEl.clientWidth / cols;
  const ch = tab.xtermEl.clientHeight / rows;
  if (cw > 0) tab.charWidth = cw;
  if (ch > 0) tab.charHeight = ch;
  showSizeHint(cols, rows);

  // defer PTY resize (expensive IPC) until resize stops
  const tabId = tab.id;
  if (resizeTimer) clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    resizeTimer = null;
    const t = tabs.get(tabId);
    if (t) {
      invoke("pty_resize", { id: t.id, cols: t.terminal.cols, rows: t.terminal.rows });
    }
  }, 250);
});

// ── new tab button + profile dropdown ──────────────────────────────

newTabButton.addEventListener("click", () => {
  // explicit default → first profile → cmd.exe
  const defName = defaultLocalProfile ?? localProfiles[0]?.name ?? null;
  const p = defName ? localProfiles.find(x => x.name === defName) : null;
  if (p) { createCustomTab(p.command, p.name); }
  else { createTab(); }
});

const menuBtn = document.getElementById("new-tab-menu-btn")!;
const profileMenu = document.createElement("div");
profileMenu.id = "profile-menu";
profileMenu.className = "profile-menu";
document.body.appendChild(profileMenu);

function positionMenu() {
  const rect = menuBtn.getBoundingClientRect();
  profileMenu.style.left = (rect.left + rect.width / 2) + "px";
  profileMenu.style.top = rect.bottom + "px";
}

function flipMenu() {
  const rect = menuBtn.getBoundingClientRect();
  const mw = profileMenu.offsetWidth;
  const mh = profileMenu.offsetHeight;
  const pad = 4;

  // center below button
  let left = rect.left + rect.width / 2 - mw / 2;
  let top = rect.bottom;

  // clamp horizontal
  if (left < pad) left = pad;
  if (left + mw > window.innerWidth) left = window.innerWidth - mw - pad;
  // flip vertical if overflow bottom
  if (top + mh > window.innerHeight) top = Math.max(pad, rect.top - mh);

  profileMenu.style.left = left + "px";
  profileMenu.style.top = top + "px";
}

function createMenuItem(iconFn: any, label: string, detail: string, onClick: () => void): HTMLElement {
  const item = document.createElement("div");
  item.className = "profile-item";

  const iconWrap = document.createElement("span");
  iconWrap.className = "item-icon";
  iconWrap.appendChild(createElement(iconFn, { stroke: "currentColor", width: 14, height: 14 }));
  item.appendChild(iconWrap);

  const labelEl = document.createElement("span");
  labelEl.className = "item-label";
  labelEl.textContent = label;
  item.appendChild(labelEl);

  if (detail) {
    const detailEl = document.createElement("span");
    detailEl.className = "item-detail";
    detailEl.textContent = detail;
    item.appendChild(detailEl);
  }

  item.addEventListener("click", () => {
    profileMenu.classList.remove("open");
    onClick();
  });

  return item;
}

function populateMenu() {
  profileMenu.innerHTML = "";

  // Local column
  const localCol = document.createElement("div");
  localCol.className = "profile-col";

  const localTitle = document.createElement("div");
  localTitle.className = "profile-section-title";
  localTitle.textContent = "Local";
  localCol.appendChild(localTitle);

  if (localProfiles.length > 0) {
    for (const p of localProfiles) {
      localCol.appendChild(createMenuItem(TerminalIcon, p.name, "", () => createCustomTab(p.command, p.name)));
    }
  } else {
    localCol.appendChild(createMenuItem(TerminalIcon, "Default shell", "", () => createTab()));
  }
  profileMenu.appendChild(localCol);

  // SSH column
  if (sshHosts.length > 0) {
    const sshCol = document.createElement("div");
    sshCol.className = "profile-col";

    const sshTitle = document.createElement("div");
    sshTitle.className = "profile-section-title";
    sshTitle.textContent = "SSH";
    sshCol.appendChild(sshTitle);

    for (const host of sshHosts) {
      const detail = `${host.user}@${host.hostname}:${host.port}`;
      sshCol.appendChild(createMenuItem(Globe, host.name, detail, () => createSshTab(host)));
    }
    profileMenu.appendChild(sshCol);
  }
}

menuBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  if (profileMenu.classList.contains("open")) {
    profileMenu.classList.remove("open");
  } else {
    populateMenu();
    positionMenu();
    profileMenu.classList.add("open");
    requestAnimationFrame(() => flipMenu());
  }
});

document.addEventListener("click", (e) => {
  if (profileMenu.classList.contains("open") && !profileMenu.contains(e.target as Node) && e.target !== menuBtn) {
    profileMenu.classList.remove("open");
  }
});

window.addEventListener("resize", () => {
  if (profileMenu.classList.contains("open")) {
    flipMenu();
  }
});

// ── custom title bar controls ──────────────────────────────────────

const appWindow = getCurrentWindow();
const btnMaximize = document.getElementById("btn-maximize")!;

async function updateMaximizeIcon() {
  try {
    if (await appWindow.isMaximized()) {
      btnMaximize.classList.add("restore");
    } else {
      btnMaximize.classList.remove("restore");
    }
  } catch (_) { /* window API may not be ready yet */ }
}

// drag window from tab bar (skip buttons, defer to mousemove so dblclick fires)
const tabBar = document.getElementById("tab-bar")!;
tabBar.addEventListener("mousedown", (e) => {
  const target = e.target as HTMLElement;
  if (target.tagName === "BUTTON" || target.closest("button")) return;

  const cleanup = () => {
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", cleanup);
  };
  const onMove = () => {
    cleanup();
    invoke("window_start_drag");
  };
  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", cleanup);
});

// click handler for window control buttons (uses Rust commands via invoke)
tabBar.addEventListener("click", (e) => {
  const target = e.target instanceof Element ? e.target : (e.target as Node).parentElement;
  const btn = target?.closest("button");
  if (!btn) return;

  switch (btn.id) {
    case "btn-minimize":
      invoke("window_minimize");
      break;
    case "btn-maximize":
      invoke("window_toggle_maximize");
      break;
    case "btn-close":
      invoke("window_close");
      break;
  }
});

// double-click tab bar to toggle maximize
document.getElementById("tab-bar")!.addEventListener("dblclick", (e) => {
  const target = e.target instanceof Element ? e.target : (e.target as Node).parentElement;
  if (target?.closest("button")) return;
  invoke("window_toggle_maximize");
});

appWindow.onResized(() => {
  updateMaximizeIcon();
});

updateMaximizeIcon();

// inject Lucide SVG icons into window control buttons
const btnMinimize = document.getElementById("btn-minimize")!;
const btnClose = document.getElementById("btn-close")!;

btnMinimize.appendChild(createElement(Minus, { stroke: "currentColor", width: 14, height: 14 }));
const icoMax = createElement(Square, { stroke: "currentColor", width: 14, height: 14 });
icoMax.classList.add("ico-max");
btnMaximize.appendChild(icoMax);
const icoRestore = createElement(Copy, { stroke: "currentColor", width: 14, height: 14 });
icoRestore.classList.add("ico-restore");
btnMaximize.appendChild(icoRestore);
btnClose.appendChild(createElement(X, { stroke: "currentColor", width: 14, height: 14 }));

// ── SSH hosts ───────────────────────────────────────────────────────

async function loadSshHosts() {
  try {
    sshHosts = await invoke<SshHost[]>("ssh_list_hosts");
  } catch (e) {
    console.error("Failed to load SSH hosts:", e);
  }
}

// ── Windows Terminal profiles ──────────────────────────────────────

function resolveVsProfile(name: string): string | null {
  if (vsInstalls.length === 0) return null;
  const vs = vsInstalls[0];
  if (/developer command prompt/i.test(name)) {
    return `%comspec% /k "${vs.path}\\Common7\\Tools\\VsDevCmd.bat"`;
  }
  if (/developer powershell/i.test(name)) {
    const instanceId = vs.instance_id;
    if (!instanceId) return null;
    return `powershell.exe -NoExit -Command "& { Import-Module '${vs.path}\\Common7\\Tools\\Microsoft.VisualStudio.DevShell.dll'; Enter-VsDevShell -VsInstanceId ${instanceId} }"`;
  }
  return null;
}

function parseWtProfiles(raw: string) {
  try {
    const root = JSON.parse(raw);
    const list: any[] = root?.profiles?.list;
    if (!list) return;
    localProfiles = [];
    for (const item of list) {
      if (item.hidden) continue;
      const name = item.name;
      if (!name) continue;
      let command = item.commandline;
      if (!command && /terminal\.visualstudio/i.test(item.source || "")) {
        command = resolveVsProfile(name);
      }
      if (command) {
        localProfiles.push({ name, command });
      }
    }
  } catch (e) {
    console.error("Failed to parse WT profiles:", e);
  }
}

async function loadLocalProfiles() {
  try {
    vsInstalls = await invoke<VsInstallation[]>("find_vs_instances");
  } catch (e) {
    console.error("Failed to find VS instances:", e);
  }
  try {
    const raw = await invoke<string | null>("read_wt_settings");
    if (raw) parseWtProfiles(raw);
  } catch (e) {
    console.error("Failed to load WT profiles:", e);
  }
}

// ── default profile ───────────────────────────────────────────────

async function setDefaultProfile(name: string) {
  defaultLocalProfile = name;
  try { await invoke("write_config", { content: JSON.stringify({ defaultLocalProfile: name }) }); } catch {}
}
// exposed for settings page
(window as any).setDefaultProfile = setDefaultProfile;

async function loadConfig() {
  try {
    const raw = await invoke<string>("read_config");
    const cfg = JSON.parse(raw);
    if (cfg.defaultLocalProfile) defaultLocalProfile = cfg.defaultLocalProfile;
  } catch {}
}

// ── initial tab ────────────────────────────────────────────────────

loadSshHosts();
Promise.all([loadLocalProfiles(), loadConfig()]).then(() => {
  const defName = defaultLocalProfile ?? localProfiles[0]?.name ?? null;
  const p = defName ? localProfiles.find(x => x.name === defName) : null;
  if (p) createCustomTab(p.command, p.name);
  else createTab();
});
