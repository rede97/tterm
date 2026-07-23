import { tabManager } from "./tabmanager";
import { openFind } from "./search";
import { trimPasteContent, SERIAL_BAUD_RATES } from "./profiles";
import { showToast } from "./toast";
import { invoke } from "@tauri-apps/api/core";

const TAB_COLORS = [
  "#e06c75", "#d19a66", "#e5c07b", "#98c379",
  "#56b6c2", "#61afef", "#c678dd", "#ffffff",
];

const contextMenu = document.createElement("div");
contextMenu.id = "tab-context-menu";
contextMenu.className = "tab-context-menu";
document.body.appendChild(contextMenu);

let currentTabId = "";

function closeContextMenu() {
  contextMenu.classList.remove("open");
}

function showAt(x: number, y: number) {
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

function mkItem(label: string, action: string): HTMLElement {
  const el = document.createElement("div");
  el.className = "menu-item";
  el.textContent = label;
  el.dataset.action = action;
  return el;
}

function mkSeparator(): HTMLElement {
  const el = document.createElement("div");
  el.className = "menu-separator";
  return el;
}

// -- Tab context menu group --
const tabMenuGroup = document.createElement("div");
tabMenuGroup.dataset.group = "tab";
tabMenuGroup.style.display = "none";

tabMenuGroup.appendChild(mkItem("New Tab", "new-tab"));
tabMenuGroup.appendChild(mkItem("Open in New Window", "new-window"));
tabMenuGroup.appendChild(mkSeparator());

// Color submenu
const colorItem = document.createElement("div");
colorItem.className = "menu-item has-submenu";
const colorLabel = document.createElement("span");
colorLabel.textContent = "Change Tab Color";
colorItem.appendChild(colorLabel);
const arrow = document.createElement("span");
arrow.className = "menu-arrow";
arrow.textContent = "›";
colorItem.appendChild(arrow);
tabMenuGroup.appendChild(colorItem);

const colorSub = document.createElement("div");
colorSub.className = "color-submenu";
const colorGrid = document.createElement("div");
colorGrid.className = "color-grid";
for (const c of TAB_COLORS) {
  const swatch = document.createElement("div");
  swatch.className = "color-swatch";
  swatch.style.background = c;
  swatch.dataset.color = c;
  colorGrid.appendChild(swatch);
}
const clearColorBtn = document.createElement("div");
clearColorBtn.className = "color-clear";
clearColorBtn.textContent = "Reset Color";
clearColorBtn.dataset.action = "reset-color";
colorSub.appendChild(colorGrid);
colorSub.appendChild(clearColorBtn);
colorItem.appendChild(colorSub);

colorItem.addEventListener("mouseenter", () => colorSub.classList.add("open"));
colorItem.addEventListener("mouseleave", () => colorSub.classList.remove("open"));

tabMenuGroup.appendChild(mkItem("Rename", "rename"));
tabMenuGroup.appendChild(mkItem("Duplicate Tab", "duplicate"));
tabMenuGroup.appendChild(mkSeparator());
tabMenuGroup.appendChild(mkItem("Close", "close"));
tabMenuGroup.appendChild(mkItem("Close Right", "close-right"));
tabMenuGroup.appendChild(mkItem("Close Others", "close-others"));

contextMenu.appendChild(tabMenuGroup);

// -- Terminal content menu group --
const termMenuGroup = document.createElement("div");
termMenuGroup.dataset.group = "term";
termMenuGroup.style.display = "none";

const SERIAL_BAUDS = SERIAL_BAUD_RATES;

// Baud Rate submenu (serial tabs only, mirrors the color submenu pattern)
const baudItem = document.createElement("div");
baudItem.className = "menu-item has-submenu";
baudItem.style.display = "none";
const baudLabel = document.createElement("span");
baudLabel.textContent = "Baud Rate";
baudItem.appendChild(baudLabel);
const baudArrow = document.createElement("span");
baudArrow.className = "menu-arrow";
baudArrow.textContent = "›";
baudItem.appendChild(baudArrow);

const baudSub = document.createElement("div");
baudSub.className = "baud-submenu";
for (const b of SERIAL_BAUDS) {
  const el = document.createElement("div");
  el.className = "menu-item baud-option";
  el.dataset.baud = String(b);
  baudSub.appendChild(el);
}
baudItem.appendChild(baudSub);
baudItem.addEventListener("mouseenter", () => baudSub.classList.add("open"));
baudItem.addEventListener("mouseleave", () => baudSub.classList.remove("open"));
termMenuGroup.appendChild(baudItem);

termMenuGroup.appendChild(mkItem("Copy", "copy"));
termMenuGroup.appendChild(mkItem("Copy as HTML", "copy-html"));
termMenuGroup.appendChild(mkItem("Paste", "paste"));
termMenuGroup.appendChild(mkSeparator());
termMenuGroup.appendChild(mkItem("Clear", "clear"));
termMenuGroup.appendChild(mkItem("Find", "find"));
termMenuGroup.appendChild(mkItem("Export Text", "export"));
termMenuGroup.appendChild(mkSeparator());
termMenuGroup.appendChild(mkItem("New Tab", "new-tab"));
termMenuGroup.appendChild(mkItem("Open in New Window", "new-window"));

contextMenu.appendChild(termMenuGroup);

// -- Delegated click handler --
contextMenu.addEventListener("click", (e) => {
  const target = e.target as HTMLElement;

  // Color swatch
  if (target.classList.contains("color-swatch") && target.dataset.color) {
    e.stopPropagation();
    const t = tabManager.get(currentTabId);
    if (t) t.setColor(target.dataset.color);
    closeContextMenu();
    return;
  }

  // Baud option
  if (target.classList.contains("baud-option") && target.dataset.baud) {
    e.stopPropagation();
    tabManager.setSerialBaud(currentTabId, parseInt(target.dataset.baud, 10));
    closeContextMenu();
    return;
  }

  // Menu item with data-action
  const item = target.closest("[data-action]") as HTMLElement | null;
  if (!item) return;
  e.stopPropagation();
  const action = item.dataset.action!;
  dispatch(action);
  closeContextMenu();
});

function dispatch(action: string) {
  const tabId = currentTabId;
  switch (action) {
    case "new-tab":
      tabManager.createLocalTab();
      break;
    case "new-window":
      invoke("open_new_window").catch((e) => showToast(`Failed to open new window: ${e}`, "error"));
      break;
    case "reset-color": {
      const t = tabManager.get(tabId);
      if (t) t.setColor(undefined);
      break;
    }
    case "rename":
      tabManager.renameTab(tabId);
      break;
    case "duplicate":
      tabManager.duplicateTab(tabId);
      break;
    case "close":
      tabManager.closeTab(tabId);
      break;
    case "close-right":
      tabManager.closeTabsRight(tabId);
      break;
    case "close-others":
      tabManager.closeOtherTabs(tabId);
      break;
    case "copy": {
      const t = tabManager.get(tabId);
      if (!t) break;
      const sel = t.terminal.getSelection();
      if (sel) {
        const ta = document.createElement("textarea");
        ta.value = sel;
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      break;
    }
    case "copy-html": {
      const t = tabManager.get(tabId);
      if (!t) break;
      const sel = t.terminal.getSelection();
      if (sel) {
        const html = `<pre style="font-family:'JetBrains Mono',Consolas,monospace;font-size:13px;color:#d4d4d4;background:#1e1e1e;padding:8px;margin:0;overflow:auto;white-space:pre-wrap;word-wrap:break-word;">${sel.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>`;
        const blob = new Blob([html], { type: "text/html" });
        const plain = new Blob([sel], { type: "text/plain" });
        navigator.clipboard.write([
          new ClipboardItem({ "text/plain": plain, "text/html": blob }),
        ]).catch(() => {});
      }
      break;
    }
    case "paste": {
      const t = tabManager.get(tabId);
      if (!t) break;
      navigator.clipboard.readText().then(text => {
        if (text) t.terminal.paste(trimPasteContent(text));
      }).catch(() => {});
      break;
    }
    case "clear":
      tabManager.clearTab(tabId);
      break;
    case "find":
      tabManager.switchTo(tabId);
      openFind(tabId);
      break;
    case "export":
      tabManager.exportTab(tabId);
      break;
  }
}

// -- Public API --
export function showTabContextMenu(tabId: string, x: number, y: number) {
  currentTabId = tabId;
  tabMenuGroup.style.display = "";
  termMenuGroup.style.display = "none";
  showAt(x, y);
}

export function showTerminalContextMenu(tabId: string, x: number, y: number) {
  currentTabId = tabId;
  // Baud Rate submenu is serial-only; refresh checkmarks from the tab state
  const tab = tabManager.get(tabId);
  const isSerial = tab?.type === "serial";
  baudItem.style.display = isSerial ? "" : "none";
  if (isSerial) {
    baudSub.querySelectorAll<HTMLElement>(".baud-option").forEach(el => {
      const b = parseInt(el.dataset.baud!, 10);
      el.textContent = b === tab!.serialBaud ? `${b} ✓` : String(b);
    });
  }
  tabMenuGroup.style.display = "none";
  termMenuGroup.style.display = "";
  showAt(x, y);
}

export function initContextMenu() {
  document.addEventListener("click", (e) => {
    if (contextMenu.classList.contains("open") && !contextMenu.contains(e.target as Node)) {
      closeContextMenu();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && contextMenu.classList.contains("open")) {
      closeContextMenu();
    }
    if (e.key === "F" && e.ctrlKey && e.shiftKey && tabManager.activeTabId) {
      e.preventDefault();
      openFind(tabManager.activeTabId);
    }
  });
}
