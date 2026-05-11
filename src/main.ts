import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getVersion } from "@tauri-apps/api/app";
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

type TabType = "local" | "ssh";

interface Tab {
  id: string;
  terminal: Terminal;
  fitAddon: FitAddon;
  searchAddon: SearchAddon;
  element: HTMLElement;
  tabElement: HTMLElement;
  xtermEl: HTMLElement;
  charWidth: number;
  charHeight: number;
  type: TabType;
  command?: string;
  sshHost?: SshHost;
  label: string;
  color?: string;
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

// ── welcome screen (no tabs) ──────────────────────────────────────

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

function showWelcome() {
  welcomeEl.style.display = "flex";
}

function hideWelcome() {
  welcomeEl.style.display = "none";
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

// ── search / find bar ──────────────────────────────────────────────

const searchBar = document.createElement("div");
searchBar.id = "search-bar";
searchBar.style.display = "none";
terminalContainer.appendChild(searchBar);

const searchInput = document.createElement("input");
searchInput.type = "text";
searchInput.placeholder = "查找...";
searchBar.appendChild(searchInput);

const searchPrev = document.createElement("button");
searchPrev.textContent = "▲";
searchBar.appendChild(searchPrev);

const searchNext = document.createElement("button");
searchNext.textContent = "▼";
searchBar.appendChild(searchNext);

const searchResults = document.createElement("span");
searchResults.id = "search-results";
searchBar.appendChild(searchResults);

const searchClose = document.createElement("button");
searchClose.textContent = "✕";
searchClose.className = "search-close";
searchBar.appendChild(searchClose);

function closeFind() {
  searchBar.style.display = "none";
  const tabId = searchInput.dataset.tabId;
  if (tabId) {
    const tab = tabs.get(tabId);
    if (tab) tab.terminal.focus();
  }
}

function doFindNext() {
  const tabId = searchInput.dataset.tabId;
  const tab = tabs.get(tabId || "");
  if (!tab?.searchAddon || !searchInput.value) return;
  const found = tab.searchAddon.findNext(searchInput.value);
  searchResults.textContent = found ? "" : "无结果";
}

function doFindPrev() {
  const tabId = searchInput.dataset.tabId;
  const tab = tabs.get(tabId || "");
  if (!tab?.searchAddon || !searchInput.value) return;
  const found = tab.searchAddon.findPrevious(searchInput.value);
  searchResults.textContent = found ? "" : "无结果";
}

searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    if (e.shiftKey) doFindPrev();
    else doFindNext();
  } else if (e.key === "Escape") {
    closeFind();
  }
});

searchNext.addEventListener("click", doFindNext);
searchPrev.addEventListener("click", doFindPrev);
searchClose.addEventListener("click", closeFind);

function openFind(tabId: string) {
  const tab = tabs.get(tabId);
  if (!tab?.searchAddon) return;

  searchInput.dataset.tabId = tabId;
  searchInput.value = "";
  searchResults.textContent = "";
  searchBar.style.display = "flex";
  searchInput.focus();
}

// ── terminal factory ───────────────────────────────────────────────

function createTerminal(): {
  terminal: Terminal;
  fitAddon: FitAddon;
  searchAddon: SearchAddon;
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
  const searchAddon = new SearchAddon();
  terminal.loadAddon(searchAddon);
  terminal.open(element);

  return {
    terminal,
    fitAddon,
    searchAddon,
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

  const badge = document.createElement("span");
  badge.className = "tab-badge";
  tab.appendChild(badge);

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

  tab.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    e.stopPropagation();
    showContextMenu(id, e.clientX, e.clientY);
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
    tab.terminal.focus();
    activeTabId = id;
  }
}

async function closeTab(id: string): Promise<void> {
  const tab = tabs.get(id);
  if (!tab) return;

  await invoke("pty_kill", { id });

  // restore tabs to right of this one
  const tabEl = tab.tabElement;
  const nextSibling = tabEl.nextElementSibling;
  tab.element.remove();
  tabEl.remove();
  tabs.delete(id);

  if (activeTabId === id) {
    if (nextSibling) {
      switchTab((nextSibling as HTMLElement).dataset.tabId!);
    } else {
      const remaining = Array.from(tabs.keys());
      if (remaining.length > 0) {
        switchTab(remaining[remaining.length - 1]);
      } else {
        activeTabId = null;
        showWelcome();
      }
    }
  }
  refreshTabBadges();
}

function getTabIndex(id: string): number {
  const tabEl = tabs.get(id)?.tabElement;
  if (!tabEl?.parentElement) return -1;
  return Array.from(tabEl.parentElement.children).indexOf(tabEl);
}

function setupTab(id: string, label: string, type: TabType, command?: string, sshHost?: SshHost): void {
  const { terminal, fitAddon, searchAddon, element, xtermEl } = createTerminal();
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
    searchAddon,
    element,
    tabElement,
    xtermEl,
    charWidth: 0,
    charHeight: 0,
    type,
    command,
    sshHost,
    label,
  });

  hideWelcome();
  switchTab(id);
  // double rAF: wait for xterm renderer to init cell dimensions after display → visible
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const t = tabs.get(id);
      if (t) {
        const { cols, rows } = applyFit(t);
        invoke("pty_resize", { id: t.id, cols, rows });
      }
    });
  });
  refreshTabBadges();
}

async function createTab(): Promise<void> {
  const id: string = await invoke("pty_spawn");
  setupTab(id, "Terminal", "local");
}

async function createSshTab(host: SshHost): Promise<void> {
  const id: string = await invoke("pty_spawn_ssh", {
    hostname: host.hostname,
    port: host.port,
    user: host.user,
  });
  setupTab(id, host.name, "ssh", undefined, host);
}

async function createCustomTab(command: string, label: string): Promise<void> {
  const id: string = await invoke("pty_spawn", { command });
  setupTab(id, label, "local", command);
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

const newTabGroup = document.getElementById("new-tab-group")!;

function flipMenu() {
  const groupRect = newTabGroup.getBoundingClientRect();
  const mw = profileMenu.offsetWidth;
  const mh = profileMenu.offsetHeight;
  const pad = 4;

  let left = groupRect.left;
  let top = groupRect.bottom;

  if (left < pad) left = pad;
  if (left + mw > window.innerWidth) left = window.innerWidth - mw - pad;
  if (top + mh > window.innerHeight) top = Math.max(pad, groupRect.top - mh);

  profileMenu.style.left = left + "px";
  profileMenu.style.top = top + "px";
}

function createMenuItem(iconFn: any, label: string, detail: string, onClick: () => void, onAdminClick?: () => void): HTMLElement {
  const item = document.createElement("div");
  item.className = "profile-item";
  if (onAdminClick) item.classList.add("admin-available");

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
    if (isShiftDown && onAdminClick) onAdminClick();
    else onClick();
  });

  return item;
}

function populateMenu() {
  profileMenu.innerHTML = "";

  const localCol = document.createElement("div");
  localCol.className = "profile-col";

  const localTitle = document.createElement("div");
  localTitle.className = "profile-section-title";
  localTitle.textContent = "Local";
  localCol.appendChild(localTitle);

  if (localProfiles.length > 0) {
    for (const p of localProfiles) {
      localCol.appendChild(createMenuItem(TerminalIcon, p.name, "", () => createCustomTab(p.command, p.name), () => createAdminTab(p.command)));
    }
  } else {
    localCol.appendChild(createMenuItem(TerminalIcon, "Default shell", "", () => createTab(), () => createAdminTab()));
  }
  profileMenu.appendChild(localCol);

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
    if (isShiftDown) profileMenu.classList.add("shift-held");
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

// ── tab context menu ────────────────────────────────────────────────

const TAB_COLORS = [
  "#e06c75", "#d19a66", "#e5c07b", "#98c379",
  "#56b6c2", "#61afef", "#c678dd", "#ffffff",
];

const contextMenu = document.createElement("div");
contextMenu.id = "tab-context-menu";
contextMenu.className = "tab-context-menu";
document.body.appendChild(contextMenu);

function closeContextMenu() {
  contextMenu.classList.remove("open");
}

function addMenuSeparator() {
  const sep = document.createElement("div");
  sep.className = "menu-separator";
  contextMenu.appendChild(sep);
}

function addMenuAction(label: string, fn: () => void): HTMLElement {
  const el = document.createElement("div");
  el.className = "menu-item";
  el.textContent = label;
  el.addEventListener("click", (e) => {
    e.stopPropagation();
    fn();
    closeContextMenu();
  });
  contextMenu.appendChild(el);
  return el;
}

function populateContextMenu(tabId: string) {
  contextMenu.innerHTML = "";

  // ── Color submenu ──
  const colorItem = document.createElement("div");
  colorItem.className = "menu-item has-submenu";
  const colorLabel = document.createElement("span");
  colorLabel.textContent = "更改选项卡颜色";
  colorItem.appendChild(colorLabel);
  const arrow = document.createElement("span");
  arrow.className = "menu-arrow";
  arrow.textContent = "›";
  colorItem.appendChild(arrow);
  contextMenu.appendChild(colorItem);

  const colorSub = document.createElement("div");
  colorSub.className = "color-submenu";
  const colorGrid = document.createElement("div");
  colorGrid.className = "color-grid";
  for (const c of TAB_COLORS) {
    const swatch = document.createElement("div");
    swatch.className = "color-swatch";
    swatch.style.background = c;
    swatch.addEventListener("click", (e) => {
      e.stopPropagation();
      setTabColor(tabId, c);
      closeContextMenu();
    });
    colorGrid.appendChild(swatch);
  }
  const clearBtn = document.createElement("div");
  clearBtn.className = "color-clear";
  clearBtn.textContent = "清除颜色";
  clearBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    setTabColor(tabId, undefined);
    closeContextMenu();
  });
  colorSub.appendChild(colorGrid);
  colorSub.appendChild(clearBtn);
  colorItem.appendChild(colorSub);

  // show submenu on hover
  colorItem.addEventListener("mouseenter", () => colorSub.classList.add("open"));
  colorItem.addEventListener("mouseleave", () => colorSub.classList.remove("open"));

  // ── Actions ──
  addMenuAction("重命名", () => renameTab(tabId));
  addMenuAction("复制选项卡", () => duplicateTab(tabId));
  addMenuAction("以管理员身份复制", () => duplicateAdminTab(tabId));
  addMenuAction("导出文本", () => exportTab(tabId));
  addMenuAction("查找", () => {
    switchTab(tabId);
    openFind(tabId);
  });

  addMenuSeparator();

  addMenuAction("关闭", () => closeTab(tabId));
  addMenuAction("关闭右侧", () => closeTabsRight(tabId));
  addMenuAction("关闭其他标签", () => closeOtherTabs(tabId));
}

function showContextMenu(tabId: string, x: number, y: number) {
  populateContextMenu(tabId);
  contextMenu.style.left = x + "px";
  contextMenu.style.top = y + "px";
  contextMenu.classList.add("open");

  requestAnimationFrame(() => {
    const rect = contextMenu.getBoundingClientRect();
    const pad = 4;
    let left = x;
    let top = y;
    if (left + rect.width > window.innerWidth - pad) left = window.innerWidth - rect.width - pad;
    if (top + rect.height > window.innerHeight - pad) top = window.innerHeight - rect.height - pad;
    contextMenu.style.left = Math.max(pad, left) + "px";
    contextMenu.style.top = Math.max(pad, top) + "px";
  });
}

document.addEventListener("click", (e) => {
  if (contextMenu.classList.contains("open") && !contextMenu.contains(e.target as Node)) {
    closeContextMenu();
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && contextMenu.classList.contains("open")) {
    closeContextMenu();
  }
  // Ctrl+Shift+F → open find
  if (e.key === "F" && e.ctrlKey && e.shiftKey && activeTabId) {
    e.preventDefault();
    openFind(activeTabId);
  }
});

// ── tab feature implementations ────────────────────────────────────

function setTabColor(id: string, color?: string) {
  const tab = tabs.get(id);
  if (!tab) return;
  tab.color = color;
  const badge = tab.tabElement.querySelector(".tab-badge") as HTMLElement;
  if (color) {
    tab.tabElement.style.borderLeft = `3px solid ${color}`;
    tab.tabElement.style.paddingLeft = "9px";
    if (badge) badge.style.color = color;
  } else {
    tab.tabElement.style.borderLeft = "";
    tab.tabElement.style.paddingLeft = "";
    if (badge) badge.style.color = "";
  }
}

function renameTab(id: string) {
  const tab = tabs.get(id);
  if (!tab) return;
  const newName = prompt("重命名选项卡", tab.label);
  if (newName && newName.trim()) {
    tab.label = newName.trim();
    tab.command = undefined; // label changed, don't reuse as command
    const labelEl = tab.tabElement.querySelector(".tab-label") as HTMLElement;
    if (labelEl) labelEl.textContent = tab.label;
  }
}

function duplicateTab(id: string) {
  const tab = tabs.get(id);
  if (!tab) return;
  if (tab.type === "ssh" && tab.sshHost) {
    createSshTab(tab.sshHost);
  } else if (tab.command) {
    createCustomTab(tab.command, tab.label);
  } else {
    createTab();
  }
}

async function duplicateAdminTab(id: string) {
  const tab = tabs.get(id);
  if (!tab) return;
  const cmd = tab.type === "local" ? tab.command : undefined;
  const label = tab.label;
  const tabId: string = await invoke("pty_spawn_elevated", { command: cmd || null });
  setupTab(tabId, `${label} (Admin)`, "local", cmd);
}

function exportTab(id: string) {
  const tab = tabs.get(id);
  if (!tab) return;

  const buffer = tab.terminal.buffer.active;
  const lines: string[] = [];
  for (let y = 0; y < buffer.length; y++) {
    const line = buffer.getLine(y);
    if (line) {
      // strip trailing whitespace from each line
      lines.push(line.translateToString().trimEnd());
    }
  }
  const text = lines.join("\n");
  invoke("save_text_file", { content: text }).catch(console.error);
}

function closeTabsRight(id: string) {
  const idx = getTabIndex(id);
  if (idx === -1) return;
  const ids = Array.from(tabs.keys()).filter(tid => getTabIndex(tid) > idx);
  for (const tid of ids) closeTab(tid);
}

function closeOtherTabs(id: string) {
  const ids = Array.from(tabs.keys()).filter(tid => tid !== id);
  for (const tid of ids) closeTab(tid);
}

function refreshTabBadges() {
  const tabEls = tabsContainer.querySelectorAll(".tab");
  tabEls.forEach((el, i) => {
    const badge = el.querySelector(".tab-badge") as HTMLElement;
    if (badge) badge.textContent = String(i + 1);
  });
}

let isShiftDown = false;

document.addEventListener("keydown", (e) => {
  if (e.key === "Shift" && !isShiftDown) {
    isShiftDown = true;
    if (profileMenu.classList.contains("open")) {
      profileMenu.classList.add("shift-held");
    }
  }
});

document.addEventListener("keyup", (e) => {
  if (e.key === "Shift") {
    isShiftDown = false;
    profileMenu.classList.remove("shift-held");
  }
});

// blur loses modifier state
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    isShiftDown = false;
    profileMenu.classList.remove("shift-held");
  }
});

async function createAdminTab(command?: string): Promise<void> {
  const id: string = await invoke("pty_spawn_elevated", { command: command ?? null });
  setupTab(id, command ? `${command} (Admin)` : "Admin", "local", command);
}

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

  const startX = e.clientX;
  const startY = e.clientY;

  const cleanup = () => {
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", cleanup);
  };
  const onMove = (e: MouseEvent) => {
    // 5px threshold — prevents accidental drag from click-movement during tab switch
    if (Math.abs(e.clientX - startX) < 5 && Math.abs(e.clientY - startY) < 5) return;
    cleanup();
    invoke("window_start_drag");
  };
  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", cleanup);
});

// click handler for window control buttons
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

getVersion().then(v => { welcomeVersion.textContent = `v${v}`; }).catch(() => {});

loadSshHosts();
Promise.all([loadLocalProfiles(), loadConfig()]).then(() => {
  const defName = defaultLocalProfile ?? localProfiles[0]?.name ?? null;
  const p = defName ? localProfiles.find(x => x.name === defName) : null;
  if (p) createCustomTab(p.command, p.name);
  else createTab();
}).catch(() => {
  // if everything fails, show welcome
  showWelcome();
});
