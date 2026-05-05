import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "@xterm/xterm/css/xterm.css";

interface PtyOutputPayload {
  id: string;
  data: number[];
}

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

async function createTab(): Promise<void> {
  const id: string = await invoke("pty_spawn");

  const { terminal, fitAddon, element, xtermEl } = createTerminal();
  const tabElement = createTabElement(id);

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

// ── new tab button ─────────────────────────────────────────────────

newTabButton.addEventListener("click", () => {
  createTab();
});

// ── initial tab ────────────────────────────────────────────────────

createTab();
