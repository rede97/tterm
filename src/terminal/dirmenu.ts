// Directory launch for the "+" button:
//   Shift+click  — pick a folder, open the default shell there
//   Right-click  — recent-folders menu (with a Browse… entry on top)
// Recent folders persist in config.recentDirectories (most-recent first).

import { invoke } from "@tauri-apps/api/core";
import { createElement, FolderOpen, Folder } from "lucide";
import { configStore } from "../core/store";
import { tabManager } from "./tabmanager";
import { logCatch } from "../core/errorlog";

const MAX_RECENT = 10;

function dirName(p: string): string {
  const norm = p.replace(/[\\/]+$/, "");
  return norm.split(/[\\/]/).pop() || p;
}

export function rememberDirectory(dir: string): void {
  const rest = configStore.get("recentDirectories")
    .filter(d => d.toLowerCase() !== dir.toLowerCase());
  configStore.set({ recentDirectories: [dir, ...rest].slice(0, MAX_RECENT) });
}

export async function launchDirectoryTab(dir: string): Promise<void> {
  rememberDirectory(dir);
  await tabManager.createLocalTab(undefined, dirName(dir), dir);
}

export async function pickAndLaunchDirectory(): Promise<void> {
  try {
    const dir = await invoke<string | null>("pick_directory");
    if (dir) await launchDirectoryTab(dir);
  } catch (e) {
    logCatch("pick_directory")(e);
  }
}

// -- recent-folders context menu --

let menuEl: HTMLElement | null = null;
let dismissHandlers: (() => void) | null = null;

export function closeDirectoryMenu(): void {
  if (menuEl) {
    menuEl.remove();
    menuEl = null;
  }
  if (dismissHandlers) {
    dismissHandlers();
    dismissHandlers = null;
  }
}

function mkItem(iconFn: Parameters<typeof createElement>[0], label: string, onClick: () => void): HTMLElement {
  const item = document.createElement("div");
  item.className = "profile-item";
  const iconWrap = document.createElement("span");
  iconWrap.className = "item-icon";
  iconWrap.appendChild(createElement(iconFn, { stroke: "currentColor", width: 14, height: 14 }));
  item.appendChild(iconWrap);
  const labelEl = document.createElement("span");
  labelEl.className = "item-label";
  labelEl.textContent = label;
  item.appendChild(labelEl);
  item.addEventListener("click", () => {
    closeDirectoryMenu();
    onClick();
  });
  return item;
}

export function showDirectoryMenu(anchor: HTMLElement): void {
  if (menuEl) {
    closeDirectoryMenu();
    return;
  }

  const menu = document.createElement("div");
  // Reuse the profile-menu look (fixed dropdown, items, separators).
  menu.className = "profile-menu open dir-menu";
  const col = document.createElement("div");
  col.className = "profile-col";
  menu.appendChild(col);

  col.appendChild(mkItem(FolderOpen, "Browse…", () => { pickAndLaunchDirectory(); }));

  const recent = configStore.get("recentDirectories");
  if (recent.length > 0) {
    const sep = document.createElement("div");
    sep.className = "profile-separator";
    col.appendChild(sep);
    for (const dir of recent) {
      const item = mkItem(Folder, dirName(dir), () => { launchDirectoryTab(dir); });
      item.title = dir;
      col.appendChild(item);
    }
  }

  document.body.appendChild(menu);
  menuEl = menu;

  // Anchor under the + button; flip inside the window if needed.
  const rect = anchor.getBoundingClientRect();
  menu.style.left = rect.left + "px";
  menu.style.top = rect.bottom + "px";
  requestAnimationFrame(() => {
    if (menuEl !== menu) return;
    const mw = menu.offsetWidth;
    const mh = menu.offsetHeight;
    if (rect.left + mw > window.innerWidth - 4) menu.style.left = Math.max(4, window.innerWidth - mw - 4) + "px";
    if (rect.bottom + mh > window.innerHeight - 4) menu.style.top = Math.max(4, rect.top - mh) + "px";
  });

  const onDocClick = (e: MouseEvent) => {
    if (!menu.contains(e.target as Node)) closeDirectoryMenu();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") closeDirectoryMenu();
  };
  // Delay the outside-click hookup so the opening right-click doesn't
  // immediately dismiss the menu.
  setTimeout(() => {
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
  }, 0);
  dismissHandlers = () => {
    document.removeEventListener("mousedown", onDocClick);
    document.removeEventListener("keydown", onKey);
  };
}
