// Context menu — no longer statically imports tabManager.
// Action handlers are injected via setContextMenuHandlers() to break
// the circular dependency: contextmenu ↔ tabmanager ↔ tab.

import { openFind } from "./search";
import { showPortForwardingDialog } from "./forwarding";
import { createElement, Plus, ExternalLink, Palette, Pencil, Copy, Share2, Link, Unlink, X, ArrowRightToLine, CircleX, ArrowLeftRight } from "lucide";
import { trimPasteContent, SERIAL_BAUD_RATES, SERIAL_OUTPUT_NEWLINES, SERIAL_ENTER_NEWLINES } from "../core/common";
import type { SerialEnterNewline, SerialOutputNewline } from "../core/types";
import { readText as clipboardReadText, writeText as clipboardWriteText } from "@tauri-apps/plugin-clipboard-manager";
import { showToast } from "../ui/toast";
import { configStore } from "../core/store";
import { logCatch } from "../core/errorlog";

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
  setSerialBaud: (tabId: string, baud: number) => void;
  setSerialEnterNewline: (tabId: string, mode: SerialEnterNewline) => void;
  setSerialOutputNewline: (tabId: string, mode: SerialOutputNewline) => void;
  isSerialTab: (tabId: string) => boolean;
  getSerialBaud: (tabId: string) => number | undefined;
  getSerialOutputNewline: (tabId: string) => string | undefined;
  getSerialEnterNewline: (tabId: string) => string | undefined;
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

function mkItem(label: string, action: string, iconFn?: Parameters<typeof createElement>[0]): HTMLElement {
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

const SERIAL_BAUDS = SERIAL_BAUD_RATES;

// Baud Rate submenu (serial tabs only)
const baudItem = document.createElement("div");
baudItem.className = "menu-item has-submenu";
baudItem.style.display = "none";
const baudLabel = document.createElement("span");
baudLabel.textContent = "Baud Rate";
baudItem.appendChild(baudLabel);
const baudArrow = document.createElement("span");
baudArrow.className = "menu-arrow";
baudArrow.textContent = "\u203a";
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

// Output newlines submenu (serial tabs only)
const nlItem = document.createElement("div");
nlItem.className = "menu-item has-submenu";
nlItem.style.display = "none";
const nlLabel = document.createElement("span");
nlLabel.textContent = "Output Newlines";
nlItem.appendChild(nlLabel);
const nlArrow = document.createElement("span");
nlArrow.className = "menu-arrow";
nlArrow.textContent = "\u203a";
nlItem.appendChild(nlArrow);

const nlSub = document.createElement("div");
nlSub.className = "baud-submenu";
for (const [v, label] of SERIAL_OUTPUT_NEWLINES) {
  const el = document.createElement("div");
  el.className = "menu-item nl-option";
  el.dataset.nl = v;
  el.dataset.nlLabel = label;
  nlSub.appendChild(el);
}
nlItem.appendChild(nlSub);
nlItem.addEventListener("mouseenter", () => nlSub.classList.add("open"));
nlItem.addEventListener("mouseleave", () => nlSub.classList.remove("open"));
termMenuGroup.appendChild(nlItem);

// Enter-sends submenu (serial tabs only)
const enterItem = document.createElement("div");
enterItem.className = "menu-item has-submenu";
enterItem.style.display = "none";
const enterLabel = document.createElement("span");
enterLabel.textContent = "Enter Sends";
enterItem.appendChild(enterLabel);
const enterArrow = document.createElement("span");
enterArrow.className = "menu-arrow";
enterArrow.textContent = "\u203a";
enterItem.appendChild(enterArrow);

const enterSub = document.createElement("div");
enterSub.className = "baud-submenu";
for (const [v, label] of SERIAL_ENTER_NEWLINES) {
  const el = document.createElement("div");
  el.className = "menu-item enter-option";
  el.dataset.enter = v;
  el.dataset.enterLabel = label;
  enterSub.appendChild(el);
}
enterItem.appendChild(enterSub);
enterItem.addEventListener("mouseenter", () => enterSub.classList.add("open"));
enterItem.addEventListener("mouseleave", () => enterSub.classList.remove("open"));
termMenuGroup.appendChild(enterItem);

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

  if (target.classList.contains("baud-option") && target.dataset.baud) {
    e.stopPropagation();
    _handlers?.setSerialBaud(currentTabId, parseInt(target.dataset.baud, 10));
    closeContextMenu();
    return;
  }

  if (target.classList.contains("enter-option") && target.dataset.enter) {
    e.stopPropagation();
    _handlers?.setSerialEnterNewline(currentTabId, target.dataset.enter as SerialEnterNewline);
    closeContextMenu();
    return;
  }

  if (target.classList.contains("nl-option") && target.dataset.nl) {
    e.stopPropagation();
    _handlers?.setSerialOutputNewline(currentTabId, target.dataset.nl as SerialOutputNewline);
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
        navigator.clipboard.write([
          new ClipboardItem({ "text/plain": plain, "text/html": blob }),
        ]).catch(logCatch("clipboard.writeHtml"));
      }
      break;
    }
    case "paste":
      clipboardReadText().then(text => {
        if (text) h.pasteToTab(tabId, trimPasteContent(text, configStore.get("pasteTrim")));
      }).catch(logCatch("clipboard.read"));
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
  const h = _handlers;
  const isSerial = h?.isSerialTab(tabId) ?? false;
  baudItem.style.display = isSerial ? "" : "none";
  nlItem.style.display = isSerial ? "" : "none";
  enterItem.style.display = isSerial ? "" : "none";
  if (isSerial) {
    const baud = h?.getSerialBaud(tabId);
    baudSub.querySelectorAll<HTMLElement>(".baud-option").forEach(el => {
      const b = parseInt(el.dataset.baud!, 10);
      el.textContent = b === baud ? `${b} \u2713` : String(b);
    });
    const curNl = h?.getSerialOutputNewline(tabId) ?? "keep";
    nlSub.querySelectorAll<HTMLElement>(".nl-option").forEach(el => {
      const isCur = el.dataset.nl === curNl;
      el.textContent = isCur ? `${el.dataset.nlLabel!} \u2713` : el.dataset.nlLabel!;
    });
    const curEnter = h?.getSerialEnterNewline(tabId) ?? "cr";
    enterSub.querySelectorAll<HTMLElement>(".enter-option").forEach(el => {
      const isCur = el.dataset.enter === curEnter;
      el.textContent = isCur ? `${el.dataset.enterLabel!} \u2713` : el.dataset.enterLabel!;
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
    if (e.key === "F" && e.ctrlKey && e.shiftKey) {
      const activeId = _handlers?.getActiveTabId();
      if (activeId) {
        e.preventDefault();
        openFind(activeId);
      }
    }
  });
}
