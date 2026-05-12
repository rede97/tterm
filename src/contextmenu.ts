import { appState } from "./state";
import { closeTab, setTabColor, renameTab, duplicateTab, exportTab, closeTabsRight, closeOtherTabs, switchTab } from "./tabs";
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

function populateContextMenu(tabId: string) {
  contextMenu.innerHTML = "";

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

  colorItem.addEventListener("mouseenter", () => colorSub.classList.add("open"));
  colorItem.addEventListener("mouseleave", () => colorSub.classList.remove("open"));

  addMenuAction("重命名", () => renameTab(tabId));
  addMenuAction("复制选项卡", () => duplicateTab(tabId));
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

export function showContextMenu(tabId: string, x: number, y: number) {
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
    if (e.key === "F" && e.ctrlKey && e.shiftKey && appState.activeTabId) {
      e.preventDefault();
      openFind(appState.activeTabId);
    }
  });
}
