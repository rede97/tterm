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

let sshHosts: SshHost[] = [];

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

function refitTab(tab: Tab) {
  tab.fitAddon.fit();
  const { cols, rows } = tab.terminal;
  tab.charWidth = tab.xtermEl.clientWidth / cols;
  tab.charHeight = tab.xtermEl.clientHeight / rows;
  invoke("pty_resize", { id: tab.id, cols, rows });
  showSizeHint(cols, rows);
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
    refitTab(tab);
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

// ── PTY output routing ─────────────────────────────────────────────

listen<PtyOutputPayload>("pty-output", (event) => {
  const { id, data } = event.payload;
  const tab = tabs.get(id);
  if (tab) {
    tab.terminal.write(new Uint8Array(data));
  }
});

// ── window resize: live hint immediately, fit after debounce ───────

let resizeTimer: ReturnType<typeof setTimeout> | null = null;

window.addEventListener("resize", () => {
  if (activeTabId === null) return;
  const tab = tabs.get(activeTabId);
  if (!tab) return;

  // live size estimate — instant, no terminal reflow
  if (tab.charWidth > 0) {
    const rect = tab.element.getBoundingClientRect();
    const availW = rect.width - 8;
    const availH = rect.height - 8;
    const estCols = Math.max(2, Math.floor(availW / tab.charWidth));
    const estRows = Math.max(1, Math.floor(availH / tab.charHeight));
    showSizeHint(estCols, estRows);
  }

  // defer actual fit + pty_resize until resize stops
  if (resizeTimer) clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    resizeTimer = null;
    if (activeTabId !== null) {
      const t = tabs.get(activeTabId);
      if (t) refitTab(t);
    }
  }, 150);
});

// ── new tab button + profile dropdown ──────────────────────────────

newTabButton.addEventListener("click", () => {
  createTab();
});

const menuBtn = document.getElementById("new-tab-menu-btn")!;
const profileMenu = document.createElement("div");
profileMenu.id = "profile-menu";
profileMenu.className = "profile-menu";
document.body.appendChild(profileMenu);

function positionMenu() {
  const rect = menuBtn.getBoundingClientRect();
  profileMenu.style.left = (rect.right - profileMenu.offsetWidth) + "px";
  profileMenu.style.top = rect.bottom + "px";
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

  // Local section
  const localTitle = document.createElement("div");
  localTitle.className = "profile-section-title";
  localTitle.textContent = "Local";
  profileMenu.appendChild(localTitle);

  profileMenu.appendChild(createMenuItem(TerminalIcon, "Default shell", "", () => createTab()));

  // SSH section
  if (sshHosts.length > 0) {
    const sep = document.createElement("div");
    sep.className = "profile-separator";
    profileMenu.appendChild(sep);

    const sshTitle = document.createElement("div");
    sshTitle.className = "profile-section-title";
    sshTitle.textContent = "SSH";
    profileMenu.appendChild(sshTitle);

    for (const host of sshHosts) {
      const detail = `${host.user}@${host.hostname}:${host.port}`;
      profileMenu.appendChild(createMenuItem(Globe, host.name, detail, () => createSshTab(host)));
    }
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
  }
});

document.addEventListener("click", (e) => {
  if (profileMenu.classList.contains("open") && !profileMenu.contains(e.target as Node) && e.target !== menuBtn) {
    profileMenu.classList.remove("open");
  }
});

window.addEventListener("resize", () => {
  if (profileMenu.classList.contains("open")) {
    positionMenu();
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
    console.log("SSH hosts:", sshHosts);
  } catch (e) {
    console.error("Failed to load SSH hosts:", e);
  }
}

// ── initial tab ────────────────────────────────────────────────────

createTab();
loadSshHosts();
