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
}

const tabs: Map<string, Tab> = new Map();
let activeTabId: string | null = null;

const terminalContainer = document.getElementById("terminal-container")!;
const tabsContainer = document.getElementById("tabs")!;
const newTabButton = document.getElementById("new-tab")!;

function createTerminal(): {
  terminal: Terminal;
  fitAddon: FitAddon;
  element: HTMLElement;
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

  return { terminal, fitAddon, element };
}

function createTabElement(id: string): HTMLElement {
  const tab = document.createElement("div");
  tab.className = "tab";
  tab.dataset.tabId = id;

  const label = document.createElement("span");
  label.className = "tab-label";
  label.textContent = "Terminal";

  const closeBtn = document.createElement("button");
  closeBtn.className = "tab-close";
  closeBtn.textContent = "×";
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
    tab.fitAddon.fit();
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

  const { terminal, fitAddon, element } = createTerminal();
  const tabElement = createTabElement(id);

  terminal.onData((data) => {
    invoke("pty_write", { id, data });
  });

  terminal.onResize(({ cols, rows }) => {
    invoke("pty_resize", { id, cols, rows });
  });

  tabsContainer.appendChild(tabElement);

  tabs.set(id, {
    id,
    terminal,
    fitAddon,
    element,
    tabElement,
  });

  switchTab(id);
}

listen<PtyOutputPayload>("pty-output", (event) => {
  const { id, data } = event.payload;
  const tab = tabs.get(id);
  if (tab) {
    tab.terminal.write(new Uint8Array(data));
  }
});

window.addEventListener("resize", () => {
  if (activeTabId !== null) {
    const tab = tabs.get(activeTabId);
    if (tab) {
      tab.fitAddon.fit();
    }
  }
});

newTabButton.addEventListener("click", () => {
  createTab();
});

createTab();
