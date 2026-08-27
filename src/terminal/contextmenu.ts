// Context menu — no longer statically imports tabManager.
// Action handlers are injected via setContextMenuHandlers() to break
// the circular dependency: contextmenu ↔ tabmanager ↔ tab.

import {
  readText as clipboardReadText,
  writeText as clipboardWriteText,
} from "@tauri-apps/plugin-clipboard-manager";
import {
  ArrowRightToLine,
  CircleX,
  ClipboardPaste,
  Code,
  Copy,
  createElement,
  Eraser,
  ExternalLink,
  FileDown,
  Link,
  Palette,
  Pencil,
  Search,
  Share2,
  Unlink,
  X,
} from "lucide";
import { logCatch } from "../core/errorlog";
import { handleMenuKeydown, menuItems, restoreFocus } from "../ui/menukeys";
import { placeMenuBelow } from "../ui/place-menu";
import { dismissChromePopups, registerChromePopup } from "../ui/popups";
import { openFind } from "./search";

// ---- Injected handlers ----

export interface ContextMenuHandlers {
  createLocalTab: () => void;
  getTabLabel: (tabId: string) => string;
  setTabColor: (tabId: string, color: string | undefined) => void;
  getTabColor: (tabId: string) => string | undefined;
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
// Element that had focus when the menu opened (the tab strip or the
// terminal's helper textarea for a right-click) — focus returns here.
let menuTrigger: Element | null = null;

export function closeContextMenu(restore = true) {
  contextMenu.classList.remove("open");
  closeColorSub();
  if (restore) restoreFocus(menuTrigger);
  menuTrigger = null;
}

registerChromePopup("context", () => closeContextMenu(false));

function openMenu(): void {
  dismissChromePopups("context");
  if (!contextMenu.isConnected) document.body.appendChild(contextMenu);
  contextMenu.classList.add("open");
  // Keyboard entry point: focus lands on the first usable entry.
  menuItems(contextMenu)[0]?.focus();
}

function showAtCursor(x: number, y: number): void {
  contextMenu.style.left = `${x}px`;
  contextMenu.style.top = `${y}px`;
  openMenu();
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

function showBelow(anchor: HTMLElement): void {
  openMenu();
  placeMenuBelow(contextMenu, anchor);
}

function mkItem(
  label: string,
  action: string,
  iconFn?: Parameters<typeof createElement>[0],
): HTMLButtonElement {
  const el = document.createElement("button");
  el.type = "button";
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
// Design (drafts/tabbar-preview.html): Duplicate first; "New Tab" lives on
// the + / ▾ buttons, Port Forwarding lives in the quick panel — neither
// repeats here. The color row carries a live preview of the tab's color.
const tabMenuGroup = document.createElement("div");
tabMenuGroup.dataset.group = "tab";
tabMenuGroup.style.display = "none";

tabMenuGroup.appendChild(mkItem("Duplicate Tab", "duplicate", Copy));
tabMenuGroup.appendChild(mkItem("Open in New Window", "new-window", ExternalLink));
tabMenuGroup.appendChild(mkSeparator());

// Color submenu
const colorItemWrap = document.createElement("div");
colorItemWrap.className = "menu-submenu-wrap";
const colorItem = document.createElement("button");
colorItem.type = "button";
colorItem.className = "menu-item has-submenu";
colorItem.setAttribute("aria-haspopup", "true");
colorItem.setAttribute("aria-expanded", "false");
const colorIcon = document.createElement("span");
colorIcon.className = "menu-icon";
colorIcon.appendChild(createElement(Palette, { stroke: "currentColor", width: 14, height: 14 }));
colorItem.appendChild(colorIcon);
const colorLabel = document.createElement("span");
colorLabel.textContent = "Change Tab Color";
colorItem.appendChild(colorLabel);
const colorPreview = document.createElement("span");
colorPreview.className = "menu-color-preview";
colorPreview.title = "Current tab color";
colorPreview.setAttribute("aria-hidden", "true");
colorItem.appendChild(colorPreview);
colorItemWrap.appendChild(colorItem);
tabMenuGroup.appendChild(colorItemWrap);

const colorSub = document.createElement("div");
colorSub.className = "color-submenu";
// Inline display mirrors the .open class so the shared menu keyboard
// helper can tell the closed submenu's buttons are not reachable.
colorSub.style.display = "none";
const colorGrid = document.createElement("div");
colorGrid.className = "color-grid";
for (const c of TAB_COLORS) {
  const swatch = document.createElement("button");
  swatch.type = "button";
  swatch.className = "color-swatch";
  swatch.style.background = c;
  swatch.dataset.color = c;
  swatch.setAttribute("aria-label", `Tab color ${c}`);
  swatch.title = c;
  colorGrid.appendChild(swatch);
}
const clearColorBtn = document.createElement("button");
clearColorBtn.type = "button";
clearColorBtn.className = "color-clear";
clearColorBtn.textContent = "Reset Color";
clearColorBtn.dataset.action = "reset-color";
colorSub.appendChild(colorGrid);
colorSub.appendChild(clearColorBtn);
// Sibling of the item inside a non-interactive wrapper: a <button> must
// not nest interactive content, while the wrapper preserves one shared
// mouse hover region for the parent item and its flyout.
colorItemWrap.appendChild(colorSub);

function openColorSub(focusFirst = false) {
  colorSub.classList.add("open");
  colorSub.style.display = "";
  colorItem.setAttribute("aria-expanded", "true");
  if (focusFirst) menuItems(colorSub)[0]?.focus();
}

function closeColorSub(refocus = false) {
  colorSub.classList.remove("open");
  colorSub.style.display = "none";
  colorItem.setAttribute("aria-expanded", "false");
  if (refocus && contextMenu.classList.contains("open")) colorItem.focus();
}

colorItemWrap.addEventListener("mouseenter", () => openColorSub());
colorItemWrap.addEventListener("mouseleave", () => {
  // Keyboard focus inside the submenu outranks the mouse leaving.
  if (!colorSub.contains(document.activeElement)) closeColorSub();
});

tabMenuGroup.appendChild(mkItem("Rename", "rename", Pencil));
// Share state decides which of these three is visible (showTabContextMenu).
const shareItem = mkItem("Share with AI", "share", Share2);
const copyShareItem = mkItem("Copy Share Link", "copy-share", Link);
const stopShareItem = mkItem("Stop Sharing", "share", Unlink);
tabMenuGroup.appendChild(shareItem);
tabMenuGroup.appendChild(copyShareItem);
tabMenuGroup.appendChild(stopShareItem);
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

termMenuGroup.appendChild(mkItem("Copy", "copy", Copy));
termMenuGroup.appendChild(mkItem("Copy as HTML", "copy-html", Code));
termMenuGroup.appendChild(mkItem("Paste", "paste", ClipboardPaste));
termMenuGroup.appendChild(mkSeparator());
termMenuGroup.appendChild(mkItem("Clear", "clear", Eraser));
termMenuGroup.appendChild(mkItem("Find", "find", Search));
termMenuGroup.appendChild(mkItem("Export Text", "export", FileDown));
termMenuGroup.appendChild(mkSeparator());
termMenuGroup.appendChild(mkItem("Open in New Window", "new-window", ExternalLink));
// Same shape as the tab menu: duplicate the current session, last row.
termMenuGroup.appendChild(mkItem("Duplicate Tab", "duplicate", Copy));

contextMenu.appendChild(termMenuGroup);

// -- Keyboard model (P1-02/P1-04) --
contextMenu.addEventListener("keydown", (e) => {
  if (!contextMenu.classList.contains("open")) return;

  // Focus inside the open color submenu: its own little list. Escape or
  // ArrowLeft returns to the parent item; Enter/Space picks a color.
  if (colorSub.classList.contains("open") && colorSub.contains(document.activeElement)) {
    if (e.key === "Escape" || e.key === "ArrowLeft") {
      e.preventDefault();
      e.stopPropagation();
      closeColorSub(true);
      return;
    }
    handleMenuKeydown(e, {
      items: () => menuItems(colorSub),
      close: () => closeColorSub(true),
    });
    return;
  }

  // The submenu parent opens with ArrowRight (Enter/Space fall through to
  // the shared handler, which clicks the button — see its click listener).
  if (e.key === "ArrowRight" && document.activeElement === colorItem) {
    e.preventDefault();
    e.stopPropagation();
    openColorSub(true);
    return;
  }

  handleMenuKeydown(e, {
    items: () => menuItems(contextMenu),
    close: () => closeContextMenu(),
  });
});

// Keyboard open of the color submenu (mouse uses hover; a click while it
// is already hover-open leaves it alone).
colorItem.addEventListener("click", () => {
  if (!colorSub.classList.contains("open")) openColorSub(true);
});

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
  const action = item.dataset.action;
  if (!action) return;
  // Close first: the restore lands on the trigger, then the action claims
  // its own focus (Find focuses the search input, Rename its dialog…).
  closeContextMenu();
  dispatch(action);
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
        clipboardWriteText(url).catch(logCatch("clipboard.write"));
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
  }
}

// -- Public API --
export function showTabContextMenu(tabId: string, anchor: HTMLElement) {
  currentTabId = tabId;
  menuTrigger = document.activeElement;
  const shared = _handlers?.isTabShared(tabId) ?? false;
  shareItem.style.display = shared ? "none" : "";
  copyShareItem.style.display = shared ? "" : "none";
  stopShareItem.style.display = shared ? "" : "none";
  // Color row: live preview of the tab's current color + the swatch marker.
  // Uncolored tabs show the hollow hatch chip (design), never an empty slot.
  const tabColor = _handlers?.getTabColor(tabId);
  colorPreview.classList.toggle("empty", !tabColor);
  colorPreview.style.background = tabColor ?? "";
  for (const swatch of colorGrid.querySelectorAll<HTMLElement>(".color-swatch")) {
    swatch.classList.toggle("current", swatch.dataset.color === tabColor);
  }
  tabMenuGroup.style.display = "";
  termMenuGroup.style.display = "none";
  showBelow(anchor);
}

export function showTerminalContextMenu(tabId: string, x: number, y: number) {
  currentTabId = tabId;
  menuTrigger = document.activeElement;
  tabMenuGroup.style.display = "none";
  termMenuGroup.style.display = "";
  showAtCursor(x, y);
}

export function initContextMenu() {
  document.addEventListener("click", (e) => {
    if (contextMenu.classList.contains("open") && !contextMenu.contains(e.target as Node)) {
      // Outside click: the click target takes focus, no restore.
      closeContextMenu(false);
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

  // A resize invalidates the stored coordinates — close safely rather
  // than leaving the menu floating over the wrong spot.
  window.addEventListener("resize", () => {
    if (contextMenu.classList.contains("open")) closeContextMenu();
  });
}
