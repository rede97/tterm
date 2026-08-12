// Tab switcher overlay — two faces of one widget (VS Code style):
//
//  - Quick Open (Ctrl+P): input + numbered list of every tab; type a tab
//    number or a label substring to filter, Enter/click jumps.
//  - MRU switcher (Ctrl+Tab / Ctrl+Shift+Tab): no input; the list appears
//    in most-recently-used order, each Ctrl+Tab keydown steps the highlight,
//    and RELEASING Ctrl commits the switch. Escape cancels.
//
// Handlers are injected by main.ts (setTabSwitcherHandlers) — this module
// never imports TabManager, same acyclic pattern as quickpanel.ts.

import { parseCombo, resolveKeybindings } from "../core/keymap";
import { configStore } from "../core/store";

export interface SwitcherItem {
  id: string;
  label: string;
  // 1-based position in the tab strip (matches the tab badges).
  index: number;
  active: boolean;
  disconnected: boolean;
}

export interface TabSwitcherHandlers {
  // Tab-strip order (quick open) or MRU order (switcher) — caller decides.
  listTabs: (mode: "quick" | "mru") => SwitcherItem[];
  switchTo: (id: string) => void;
}

let _handlers: TabSwitcherHandlers | null = null;

export function setTabSwitcherHandlers(h: TabSwitcherHandlers): void {
  _handlers = h;
}

// ---- Pure helpers (unit-tested) ----

/** Filter quick-open items: an all-digit query targets the tab NUMBER (the user's "go to tab 2" intent); anything else is a case-insensitive label substring. */
export function filterSwitcherItems(items: SwitcherItem[], query: string): SwitcherItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  if (/^\d+$/.test(q)) return items.filter(it => String(it.index).startsWith(q));
  return items.filter(it => it.label.toLowerCase().includes(q));
}

/** Wrap-around step for the MRU highlight. */
export function stepIndex(current: number, delta: number, length: number): number {
  if (length <= 0) return 0;
  return ((current + delta) % length + length) % length;
}

// ---- Overlay ----

let overlay: HTMLElement | null = null;
let mode: "quick" | "mru" | null = null;
let items: SwitcherItem[] = [];
let selected = 0;
let listEl: HTMLElement | null = null;
let inputEl: HTMLInputElement | null = null;
// Modifier keys whose release commits the MRU switch — derived from the
// configured next/prev-tab bindings (default Ctrl+Tab / Ctrl+Shift+Tab).
let commitMods: string[] = ["Control"];

const MOD_EVENT_KEYS: Record<string, "ctrlKey" | "altKey" | "shiftKey" | "metaKey"> = {
  Control: "ctrlKey",
  Alt: "altKey",
  Shift: "shiftKey",
  Meta: "metaKey",
};

// Union of the modifiers on the next/prev-tab bindings: whichever the user
// holds to step, releasing the last one commits.
function currentCommitMods(): string[] {
  const bindings = resolveKeybindings(configStore.get("keybindings"));
  const mods = new Set<string>();
  for (const id of ["workbench.action.nextTab", "workbench.action.prevTab"]) {
    const p = parseCombo(bindings[id] ?? "");
    if (!p) continue;
    if (p.ctrl) mods.add("Control");
    if (p.alt) mods.add("Alt");
    if (p.shift) mods.add("Shift");
    if (p.meta) mods.add("Meta");
  }
  return mods.size > 0 ? [...mods] : ["Control"];
}

export function tabSwitcherOpen(): boolean {
  return overlay !== null;
}

function el(tag: string, className: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function renderList(): void {
  if (!listEl) return;
  listEl.textContent = "";
  const visible = mode === "quick" ? filterSwitcherItems(items, inputEl?.value ?? "") : items;
  if (visible.length === 0) {
    listEl.appendChild(el("div", "tab-switcher-empty", "No matching tabs"));
    return;
  }
  selected = Math.min(selected, visible.length - 1);
  visible.forEach((it, i) => {
    const row = el("div", "tab-switcher-row" + (i === selected ? " selected" : ""));
    row.dataset.tabId = it.id;
    row.appendChild(el("span", "tab-switcher-badge", String(it.index)));
    const label = el("span", "tab-switcher-label", it.label);
    if (it.disconnected) label.classList.add("disconnected");
    row.appendChild(label);
    if (it.active) row.appendChild(el("span", "tab-switcher-current", "current"));
    row.addEventListener("click", () => commit(it.id));
    row.addEventListener("mousemove", () => {
      if (selected !== i) { selected = i; renderList(); }
    });
    listEl!.appendChild(row);
  });
  listEl.querySelector(".tab-switcher-row.selected")?.scrollIntoView({ block: "nearest" });
}

function open(nextMode: "quick" | "mru", startSelected: number): void {
  close();
  if (!_handlers) return;
  mode = nextMode;
  items = _handlers.listTabs(nextMode);
  selected = startSelected;

  overlay = el("div", "tab-switcher-overlay");
  const panel = el("div", "tab-switcher-panel");
  if (mode === "quick") {
    inputEl = document.createElement("input");
    inputEl.className = "tab-switcher-input";
    inputEl.placeholder = "Go to tab — type a number or name";
    inputEl.addEventListener("input", () => { selected = 0; renderList(); });
    inputEl.addEventListener("keydown", onQuickKeydown);
    panel.appendChild(inputEl);
  } else {
    panel.appendChild(el("div", "tab-switcher-hint", "Release Ctrl to switch"));
  }
  listEl = el("div", "tab-switcher-list");
  panel.appendChild(listEl);
  overlay.appendChild(panel);
  // Click on the backdrop cancels (MRU: no switch; quick: just close).
  overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) close(); });
  document.body.appendChild(overlay);
  renderList();

  if (mode === "quick") {
    inputEl!.focus();
  } else {
    // MRU commits when Ctrl is released; Escape cancels; a focus loss
    // (Alt+Tab away mid-gesture) commits so the overlay can't wedge.
    window.addEventListener("keyup", onMruKeyup, true);
    window.addEventListener("keydown", onMruKeydown, true);
    window.addEventListener("blur", onWindowBlur);
  }
}

function close(): void {
  if (!overlay) return;
  overlay.remove();
  overlay = null;
  mode = null;
  items = [];
  listEl = null;
  inputEl = null;
  window.removeEventListener("keyup", onMruKeyup, true);
  window.removeEventListener("keydown", onMruKeydown, true);
  window.removeEventListener("blur", onWindowBlur);
}

function commit(id: string): void {
  const h = _handlers;
  close();
  h?.switchTo(id);
}

// -- quick open --

function onQuickKeydown(e: KeyboardEvent): void {
  if (e.key === "Escape") {
    e.preventDefault();
    close();
  } else if (e.key === "Enter") {
    e.preventDefault();
    const visible = filterSwitcherItems(items, inputEl?.value ?? "");
    if (visible[selected]) commit(visible[selected].id);
  } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    const visible = filterSwitcherItems(items, inputEl?.value ?? "");
    selected = stepIndex(selected, e.key === "ArrowDown" ? 1 : -1, visible.length);
    renderList();
  }
}

export function openQuickOpen(): void {
  if (mode === "quick") { close(); return; } // toggle, like VS Code
  open("quick", 0);
}

// -- MRU switcher --

function onMruKeyup(e: KeyboardEvent): void {
  // The gesture ends when the LAST held binding modifier is released:
  // switch to the highlighted tab.
  if (!(e.key in MOD_EVENT_KEYS) || !commitMods.includes(e.key)) return;
  const stillHeld = commitMods.some(m => m !== e.key && e[MOD_EVENT_KEYS[m]]);
  if (stillHeld) return;
  e.preventDefault();
  e.stopPropagation();
  const it = items[selected];
  if (it) commit(it.id);
  else close();
}

function onMruKeydown(e: KeyboardEvent): void {
  if (e.key === "Escape") {
    e.preventDefault();
    e.stopPropagation();
    close();
  }
}

function onWindowBlur(): void {
  // Releasing Ctrl outside the window never reaches our keyup — commit
  // whatever is highlighted rather than leave the overlay stuck.
  if (mode !== "mru") return;
  const it = items[selected];
  if (it) commit(it.id);
  else close();
}

/**
 * One Ctrl+Tab (delta=1) or Ctrl+Shift+Tab (delta=-1) keydown. The first
 * press opens the list with the NEXT MRU entry highlighted (index 0 is the
 * current tab); repeats step the highlight. The keyup listener commits.
 */
export function stepMruSwitcher(delta: 1 | -1): void {
  if (!_handlers) return;
  if (mode === "quick") close();
  if (mode !== "mru") {
    const mru = _handlers.listTabs("mru");
    if (mru.length < 2) return; // nothing to switch to
    commitMods = currentCommitMods();
    // First press: Ctrl+Tab highlights the next MRU entry (index 1);
    // Ctrl+Shift+Tab wraps to the least-recent entry (index len-1).
    open("mru", stepIndex(0, delta, mru.length));
    return;
  }
  selected = stepIndex(selected, delta, items.length);
  renderList();
}
