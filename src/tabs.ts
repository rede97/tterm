import { invoke } from "@tauri-apps/api/core";
import { appState } from "./state";
import { TabType } from "./types";
import { SshHost, localProfiles, defaultLocalProfile } from "./profiles";
import { createTerminal, applyFit } from "./terminal";

// DOM refs
const tbc = document.getElementById("tabs")!;
const welcomeEl = document.getElementById("welcome")!;

function hideWelcome() { welcomeEl.style.display = "none"; }
function showWelcome() { welcomeEl.style.display = "flex"; }

// ── tab element ────────────────────────────────────────────────────

export function createTabElement(id: string): HTMLElement {
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
    import("./contextmenu").then(m => m.showContextMenu(id, e.clientX, e.clientY));
  });

  return tab;
}

// ── switch / close ─────────────────────────────────────────────────

export function switchTab(id: string): void {
  if (appState.activeTabId === id) return;

  if (appState.activeTabId !== null) {
    const current = appState.tabs.get(appState.activeTabId);
    if (current) {
      current.element.style.display = "none";
      current.tabElement.classList.remove("active");
    }
  }

  const tab = appState.tabs.get(id);
  if (tab) {
    tab.element.style.display = "";
    tab.tabElement.classList.add("active");
    tab.terminal.focus();
    appState.activeTabId = id;

    if (tab.needsResize) {
      const { cols, rows } = applyFit(tab);
      tab.needsResize = false;
      invoke("pty_resize", { id: tab.id, cols, rows });
    }
  }
}

export async function closeTab(id: string): Promise<void> {
  const tab = appState.tabs.get(id);
  if (!tab) return;

  await invoke("pty_kill", { id });

  const tabEl = tab.tabElement;
  const nextSibling = tabEl.nextElementSibling;
  tab.element.remove();
  tabEl.remove();
  appState.tabs.delete(id);

  if (appState.activeTabId === id) {
    if (nextSibling) {
      switchTab((nextSibling as HTMLElement).dataset.tabId!);
    } else {
      const remaining = Array.from(appState.tabs.keys());
      if (remaining.length > 0) {
        switchTab(remaining[remaining.length - 1]);
      } else {
        appState.activeTabId = null;
        showWelcome();
      }
    }
  }
  refreshTabBadges();
}

export function getTabIndex(id: string): number {
  const tabEl = appState.tabs.get(id)?.tabElement;
  if (!tabEl?.parentElement) return -1;
  return Array.from(tabEl.parentElement.children).indexOf(tabEl);
}

export function refreshTabBadges() {
  const tabEls = tbc.querySelectorAll(".tab");
  tabEls.forEach((el, i) => {
    const badge = el.querySelector(".tab-badge") as HTMLElement;
    if (badge) badge.textContent = String(i + 1);
  });
}

// ── setup / create ─────────────────────────────────────────────────

export function setupTab(id: string, label: string, type: TabType, command?: string, sshHost?: SshHost): void {
  const { terminal, fitAddon, searchAddon, element, xtermEl } = createTerminal();
  const tabElement = createTabElement(id);
  (tabElement.querySelector(".tab-label") as HTMLElement).textContent = label;

  terminal.onData((data) => {
    invoke("pty_write", { id, data });
  });

  tbc.appendChild(tabElement);

  appState.tabs.set(id, {
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
    needsResize: false,
  });

  hideWelcome();
  switchTab(id);
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const t = appState.tabs.get(id);
      if (t) {
        const { cols, rows } = applyFit(t);
        invoke("pty_resize", { id: t.id, cols, rows });
      }
    });
  });
  refreshTabBadges();
}

export async function createTab(): Promise<void> {
  const id: string = await invoke("pty_spawn");
  setupTab(id, "Terminal", "local");
}

export async function createSshTab(host: SshHost): Promise<void> {
  const id: string = await invoke("pty_spawn_ssh", {
    hostname: host.hostname,
    port: host.port,
    user: host.user,
  });
  setupTab(id, host.name, "ssh", undefined, host);
}

export async function createCustomTab(command: string, label: string): Promise<void> {
  const id: string = await invoke("pty_spawn", { command });
  setupTab(id, label, "local", command);
}

// ── tab features ───────────────────────────────────────────────────

export function setTabColor(id: string, color?: string) {
  const tab = appState.tabs.get(id);
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

export function renameTab(id: string) {
  const tab = appState.tabs.get(id);
  if (!tab) return;
  const newName = prompt("重命名选项卡", tab.label);
  if (newName && newName.trim()) {
    tab.label = newName.trim();
    tab.command = undefined;
    const labelEl = tab.tabElement.querySelector(".tab-label") as HTMLElement;
    if (labelEl) labelEl.textContent = tab.label;
  }
}

export function duplicateTab(id: string) {
  const tab = appState.tabs.get(id);
  if (!tab) return;
  if (tab.type === "ssh" && tab.sshHost) {
    createSshTab(tab.sshHost);
  } else if (tab.command) {
    createCustomTab(tab.command, tab.label);
  } else {
    createTab();
  }
}

export function exportTab(id: string) {
  const tab = appState.tabs.get(id);
  if (!tab) return;

  const buffer = tab.terminal.buffer.active;
  const lines: string[] = [];
  for (let y = 0; y < buffer.length; y++) {
    const line = buffer.getLine(y);
    if (line) {
      lines.push(line.translateToString().trimEnd());
    }
  }
  const text = lines.join("\n");
  invoke("save_text_file", { content: text }).catch(console.error);
}

export function closeTabsRight(id: string) {
  const idx = getTabIndex(id);
  if (idx === -1) return;
  const ids = Array.from(appState.tabs.keys()).filter(tid => getTabIndex(tid) > idx);
  for (const tid of ids) closeTab(tid);
}

export function closeOtherTabs(id: string) {
  const ids = Array.from(appState.tabs.keys()).filter(tid => tid !== id);
  for (const tid of ids) closeTab(tid);
}

// ── new tab button ─────────────────────────────────────────────────

export function initNewTabButton() {
  const btn = document.getElementById("new-tab")!;
  btn.addEventListener("click", () => {
    const defName = defaultLocalProfile ?? localProfiles[0]?.name ?? null;
    const p = defName ? localProfiles.find(x => x.name === defName) : null;
    if (p) { createCustomTab(p.command, p.name); }
    else { createTab(); }
  });
}
