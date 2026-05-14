import { tabManager } from "./tabmanager";
import { openFind } from "./search";

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

// ── Tab context menu (shift+right-click on tab bar) ──

export function showTabContextMenu(tabId: string, x: number, y: number) {
  contextMenu.innerHTML = "";

  // Color submenu
  const colorItem = document.createElement("div");
  colorItem.className = "menu-item has-submenu";
  const colorLabel = document.createElement("span");
  colorLabel.textContent = "Change Tab Color";
  colorItem.appendChild(colorLabel);
  const arrow = document.createElement("span");
  arrow.className = "menu-arrow";
  arrow.textContent = "\u203a";
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
      const t = tabManager.get(tabId);
      if (t) t.setColor(c);
      closeContextMenu();
    });
    colorGrid.appendChild(swatch);
  }
  const clearColorBtn = document.createElement("div");
  clearColorBtn.className = "color-clear";
  clearColorBtn.textContent = "Reset Color";
  clearColorBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const t = tabManager.get(tabId);
    if (t) t.setColor(undefined);
    closeContextMenu();
  });
  colorSub.appendChild(colorGrid);
  colorSub.appendChild(clearColorBtn);
  colorItem.appendChild(colorSub);

  colorItem.addEventListener("mouseenter", () => colorSub.classList.add("open"));
  colorItem.addEventListener("mouseleave", () => colorSub.classList.remove("open"));

  addMenuAction("Rename", () => tabManager.renameTab(tabId));
  addMenuAction("Duplicate Tab", () => tabManager.duplicateTab(tabId));

  addMenuSeparator();

  addMenuAction("Close", () => tabManager.closeTab(tabId));
  addMenuAction("Close Right", () => tabManager.closeTabsRight(tabId));
  addMenuAction("Close Others", () => tabManager.closeOtherTabs(tabId));

  showAt(x, y);
}

// ── Terminal content menu (shift+right-click on terminal area) ──

export function showTerminalContextMenu(tabId: string, x: number, y: number) {
  contextMenu.innerHTML = "";

  addMenuAction("Copy", () => {
    const t = tabManager.get(tabId);
    if (!t) return;
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
  });

  addMenuAction("Paste", () => {
    const t = tabManager.get(tabId);
    if (!t) return;
    navigator.clipboard.readText().then(text => {
      if (text) t.terminal.paste(text);
    }).catch(() => {});
  });

  addMenuSeparator();

  addMenuAction("Clear", () => tabManager.clearTab(tabId));
  addMenuAction("Find", () => {
    tabManager.switchTo(tabId);
    openFind(tabId);
  });
  addMenuAction("Export Text", () => tabManager.exportTab(tabId));

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
