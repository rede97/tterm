// Context menu — no longer statically imports tabManager.
// Action handlers are injected via setContextMenuHandlers() to break
// the circular dependency: contextmenu ↔ tabmanager ↔ tab.

import {
  readText as clipboardReadText,
  writeText as clipboardWriteText,
} from "@tauri-apps/plugin-clipboard-manager";
import {
  ArrowLeftRight,
  ArrowRightToLine,
  CircleX,
  Copy,
  createElement,
  ExternalLink,
  Link,
  Palette,
  Pencil,
  Plus,
  Share2,
  Unlink,
  X,
} from "lucide";
import { logCatch } from "../core/errorlog";
import { showPortForwardingDialog } from "../ui/forwarding";
import { showToast } from "../ui/toast";
import { openFind } from "./search";

// ---- Injected handlers ----

export interface ContextMenuHandlers {
  createLocalTab: () => void;
  getTabLabel: (tabId: string) => string;
  setTabColor: (tabId: string, color: string | undefined) => void;
  renameTab: (tabId: string) => void;
  duplicateTab: (tabId: string) => void;
  closeTab: (tabId: string) => void;
  closeTabsRight: (tabId: string) => void;
  closeOtherTabs: (tabId: string) => void;
  getSelection: (tabId: string) => string;
  pasteToTab: (tabId: string, text: string) => void;
  clearTab: (tabId: string) => void;
  switchTo: (tabId: string) => void;
  exportTab: (tabId: string) => void;
  getActiveTabId: () => string | null;
  newWindow: () => void;
  shareTab: (tabId: string) => void;
  isTabShared: (tabId: string) => boolean;
  getShareUrl: (tabId: string) => string | undefined;
  // Optional: true when the tab is a built-in-client SSH session; gates the
  // "Port Forwarding…" tab-menu item.
  isEmbeddedSshTab?: (tabId: string) => boolean;
}

let _handlers: ContextMenuHandlers | null = null;

export function setContextMenuHandlers(h: ContextMenuHandlers): void {
  _handlers = h;
}

// ---- DOM ----

const TAB_COLORS = [
  "#e06c75",
  "#d19a66",
  "#e5c07b",
  "#98c379",
  "#56b6c2",
  "#61afef",
  "#c678dd",
  "#ffffff",
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
  contextMenu.style.left = `${x}px`;
  contextMenu.style.top = `${y}px`;
  contextMenu.classList.add("open");

  requestAnimationFrame(() => {
    const rect = contextMenu.getBoundingClientRect();
    const pad = 4;
    let left = x;
    let top = y;
    if (left + rect.width > window.innerWidth - pad) left = window.innerWidth - rect.width - pad;
    if (top + rect.height > window.innerHeight - pad) top = window.innerHeight - rect.height - pad;
    contextMenu.style.left = `${Math.max(pad, left)}px`;
    contextMenu.style.top = `${Math.max(pad, top)}px`;
  });
}

function mkItem(
  label: string,
  action: string,
  iconFn?: Parameters<typeof createElement>[0],
): HTMLElement {
  const el = document.createElement("div");
  el.className = "menu-item";
  if (iconFn) {
    const icon = document.createElement("span");
    icon.className = "menu-icon";
    icon.appendChild(createElement(iconFn, { stroke: "currentColor", width: 14, height: 14 }));
    el.appendChild(icon);
  }
  const text = document.createElement("span");
  text.textContent = label;
  el.appendChild(text);
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

tabMenuGroup.appendChild(mkItem("New Tab", "new-tab", Plus));
tabMenuGroup.appendChild(mkItem("Open in New Window", "new-window", ExternalLink));
tabMenuGroup.appendChild(mkSeparator());

// Color submenu
const colorItem = document.createElement("div");
colorItem.className = "menu-item has-submenu";
const colorIcon = document.createElement("span");
colorIcon.className = "menu-icon";
colorIcon.appendChild(createElement(Palette, { stroke: "currentColor", width: 14, height: 14 }));
colorItem.appendChild(colorIcon);
const colorLabel = document.createElement("span");
colorLabel.textContent = "Change Tab Color";
colorItem.appendChild(colorLabel);
const arrow = document.createElement("span");
arrow.className = "menu-arrow";
arrow.textContent = "\u203a";
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

tabMenuGroup.appendChild(mkItem("Rename", "rename", Pencil));
tabMenuGroup.appendChild(mkItem("Duplicate Tab", "duplicate", Copy));
// Share state decides which of these three is visible (showTabContextMenu).
const shareItem = mkItem("Share with AI", "share", Share2);
const copyShareItem = mkItem("Copy Share Link", "copy-share", Link);
const stopShareItem = mkItem("Stop Sharing", "share", Unlink);
tabMenuGroup.appendChild(shareItem);
tabMenuGroup.appendChild(copyShareItem);
tabMenuGroup.appendChild(stopShareItem);
// Visible only for embedded-SSH tabs (see showTabContextMenu).
const portForwardItem = mkItem("Port Forwarding…", "port-forward", ArrowLeftRight);
portForwardItem.style.display = "none";
tabMenuGroup.appendChild(portForwardItem);
tabMenuGroup.appendChild(mkSeparator());
tabMenuGroup.appendChild(mkItem("Close", "close", X));
tabMenuGroup.appendChild(mkItem("Close Right", "close-right", ArrowRightToLine));
tabMenuGroup.appendChild(mkItem("Close Others", "close-others", CircleX));

contextMenu.appendChild(tabMenuGroup);

// -- Terminal content menu group --
const termMenuGroup = document.createElement("div");
termMenuGroup.dataset.group = "term";
termMenuGroup.style.display = "none";

// Serial baud/newline controls moved to the quick-status panel (quickpanel.ts).

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

  if (target.classList.contains("color-swatch") && target.dataset.color) {
    e.stopPropagation();
    _handlers?.setTabColor(currentTabId, target.dataset.color);
    closeContextMenu();
    return;
  }

  const item = target.closest("[data-action]") as HTMLElement | null;
  if (!item) return;
  e.stopPropagation();
  const action = item.dataset.action!;
  dispatch(action);
  closeContextMenu();
});

function dispatch(action: string) {
  const h = _handlers;
  if (!h) return;
  const tabId = currentTabId;
  switch (action) {
    case "new-tab":
      h.createLocalTab();
      break;
    case "new-window":
      h.newWindow();
      break;
    case "reset-color":
      h.setTabColor(tabId, undefined);
      break;
    case "rename":
      h.renameTab(tabId);
      break;
    case "duplicate":
      h.duplicateTab(tabId);
      break;
    case "share":
      h.shareTab(tabId);
      break;
    case "copy-share": {
      const url = h.getShareUrl(tabId);
      if (url) {
        clipboardWriteText(url)
          .then(() => showToast("Share link copied", "info"))
          .catch(logCatch("clipboard.write"));
      }
      break;
    }
    case "close":
      h.closeTab(tabId);
      break;
    case "close-right":
      h.closeTabsRight(tabId);
      break;
    case "close-others":
      h.closeOtherTabs(tabId);
      break;
    case "copy": {
      const sel = h.getSelection(tabId);
      if (sel) clipboardWriteText(sel).catch(logCatch("clipboard.write"));
      break;
    }
    case "copy-html": {
      const sel = h.getSelection(tabId);
      if (sel) {
        const html = `<pre style="font-family:'JetBrains Mono',Consolas,monospace;font-size:13px;color:#d4d4d4;background:#1e1e1e;padding:8px;margin:0;overflow:auto;white-space:pre-wrap;word-wrap:break-word;">${sel.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>`;
        const blob = new Blob([html], { type: "text/html" });
        const plain = new Blob([sel], { type: "text/plain" });
        navigator.clipboard
          .write([new ClipboardItem({ "text/plain": plain, "text/html": blob })])
          .catch(logCatch("clipboard.writeHtml"));
      }
      break;
    }
    case "paste":
      clipboardReadText()
        .then((text) => {
          if (text) h.pasteToTab(tabId, text);
        })
        .catch(logCatch("clipboard.read"));
      break;
    case "clear":
      h.clearTab(tabId);
      break;
    case "find":
      h.switchTo(tabId);
      openFind(tabId);
      break;
    case "export":
      h.exportTab(tabId);
      break;
    case "port-forward":
      showPortForwardingDialog(tabId);
      break;
  }
}

// -- Public API --
export function showTabContextMenu(tabId: string, x: number, y: number) {
  currentTabId = tabId;
  const shared = _handlers?.isTabShared(tabId) ?? false;
  shareItem.style.display = shared ? "none" : "";
  copyShareItem.style.display = shared ? "" : "none";
  stopShareItem.style.display = shared ? "" : "none";
  portForwardItem.style.display = (_handlers?.isEmbeddedSshTab?.(tabId) ?? false) ? "" : "none";
  tabMenuGroup.style.display = "";
  termMenuGroup.style.display = "none";
  showAt(x, y);
}

export function showTerminalContextMenu(tabId: string, x: number, y: number) {
  currentTabId = tabId;
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
    if (e.key === "F" && e.ctrlKey && e.shiftKey) {
      const activeId = _handlers?.getActiveTabId();
      if (activeId) {
        e.preventDefault();
        openFind(activeId);
      }
    }
  });
}
