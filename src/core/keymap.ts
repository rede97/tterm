// Keyboard shortcut system — command registry, key-combo parsing, and the
// global dispatcher.
//
// Design (VS Code model, shrunk to fit):
//  - KEY_COMMANDS is the declarative registry: id, display title, default
//    binding ("" = unbound, e.g. Clear Terminal ships without a shortcut).
//  - User overrides live in configStore "keybindings": { [commandId]: combo }.
//    An explicit "" override UNBINDS a command that has a default — merge is
//    plain {...defaults, ...stored}, never delete-on-empty.
//  - One window-level keydown listener in the CAPTURE phase intercepts bound
//    combos before xterm's textarea sees them (xterm would otherwise eat
//    Ctrl+W / Ctrl+Tab as terminal input).
//  - Handlers are injected by main.ts (setKeymapHandlers) so this module
//    never imports TabManager — same acyclic pattern as quickpanel.ts.
//
// Combo grammar: lowercase, modifiers first in ctrl+alt+shift+meta order,
// key last: "ctrl+shift+p", "f11", "ctrl+tab". "" means unbound.
//
// WebView2/Chromium also ships document chrome shortcuts (Print, etc.). Those
// are never useful in a terminal and are blocked even when unbound — otherwise
// Ctrl+Shift+P opens the system print dialog.

import { configStore } from "./store";

export interface KeyCommand {
  id: string;
  title: string;
  desc: string;
  default: string;
}

export const KEY_COMMANDS: readonly KeyCommand[] = [
  {
    id: "workbench.action.quickOpen",
    title: "Quick Open: Go to Tab…",
    desc: "Show a searchable list of all tabs; type a number or name to jump.",
    default: "ctrl+p",
  },
  {
    id: "workbench.action.nextTab",
    title: "View: Open Next Tab (hold Ctrl)",
    desc: "Show the tab list and step forward; releasing Ctrl switches.",
    default: "ctrl+tab",
  },
  {
    id: "workbench.action.prevTab",
    title: "View: Open Previous Tab (hold Ctrl)",
    desc: "Show the tab list and step backward; releasing Ctrl switches.",
    default: "ctrl+shift+tab",
  },
  {
    id: "workbench.action.closeTab",
    title: "View: Close Tab",
    desc: "Close the active tab (kills its session).",
    default: "ctrl+w",
  },
  {
    id: "workbench.action.toggleFullScreen",
    title: "View: Toggle Full Screen",
    desc: "Browser-style full screen: covers the taskbar, tab bar hidden — terminal content only.",
    default: "f11",
  },
  {
    id: "workbench.action.toggleZenMode",
    title: "View: Toggle Zen Mode",
    desc: "Maximize the window and hide the tab bar (stays above the taskbar, unlike Full Screen).",
    default: "shift+f11",
  },
  {
    id: "workbench.action.terminal.clear",
    title: "Terminal: Clear",
    desc: "Clear the terminal screen and scrollback. Unbound by default.",
    default: "",
  },
];

/** Chromium/WebView2 chrome shortcuts that must never reach the host. */
export const BLOCKED_BROWSER_COMBOS: ReadonlySet<string> = new Set([
  "ctrl+shift+p", // Print
]);

// ---- Combo parsing / formatting ----

export interface ParsedCombo {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
  key: string;
}

const MODIFIER_KEYS: Record<string, true> = { control: true, alt: true, shift: true, meta: true };
const COMBO_MODS: Record<string, true> = { ctrl: true, alt: true, shift: true, meta: true };

// Normalize a raw key name to the canonical combo form.
function normKey(key: string): string {
  const k = key.toLowerCase();
  if (k === " ") return "space";
  if (k === "esc") return "escape";
  return k;
}

/** Build the canonical combo string from a KeyboardEvent; null when only modifiers are pressed. */
export function comboFromEvent(e: {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
  code?: string;
}): string | null {
  let key = normKey(e.key);
  // Numpad keys share e.key with their main-row twins ("1", "+") — use
  // e.code so they stay separately bindable ("ctrl+num1" ≠ "ctrl+1").
  if (e.code?.startsWith("Numpad")) key = `num${e.code.slice(6).toLowerCase()}`;
  if (key in MODIFIER_KEYS || key === "dead") return null;
  const parts: string[] = [];
  if (e.ctrlKey) parts.push("ctrl");
  if (e.altKey) parts.push("alt");
  if (e.shiftKey) parts.push("shift");
  if (e.metaKey) parts.push("meta");
  parts.push(key);
  return parts.join("+");
}

/** Parse a canonical combo string; null when malformed. */
export function parseCombo(combo: string): ParsedCombo | null {
  if (!combo) return null;
  // A trailing "+" is the KEY itself ("ctrl++" = Ctrl + plus key): strip
  // it before splitting, or split("+") yields an empty final segment.
  // Only the canonical doubled form counts — "ctrl+" stays malformed.
  const plusKey = combo === "+" || combo.endsWith("++");
  const parts = (plusKey ? combo.slice(0, -1) : combo).split("+").filter((p) => p !== "");
  let key: string;
  let mods: Set<string>;
  if (plusKey && parts.every((p) => p in COMBO_MODS)) {
    key = "+";
    mods = new Set(parts);
  } else {
    key = parts[parts.length - 1] ?? "";
    mods = new Set(parts.slice(0, -1));
  }
  if (!key || key in MODIFIER_KEYS || key in COMBO_MODS) return null;
  for (const m of mods) {
    if (!(m in COMBO_MODS)) return null;
  }
  return {
    ctrl: mods.has("ctrl"),
    alt: mods.has("alt"),
    shift: mods.has("shift"),
    meta: mods.has("meta"),
    key,
  };
}

/** Does the keyboard event match this combo exactly (modifiers included)? */
export function comboMatches(
  e: { key: string; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean },
  combo: string,
): boolean {
  const parsed = parseCombo(combo);
  if (!parsed) return false;
  return (
    normKey(e.key) === parsed.key &&
    e.ctrlKey === parsed.ctrl &&
    e.altKey === parsed.alt &&
    e.shiftKey === parsed.shift &&
    e.metaKey === parsed.meta
  );
}

const PRETTY_KEYS: Record<string, string> = {
  tab: "Tab",
  escape: "Esc",
  enter: "Enter",
  space: "Space",
  backspace: "Backspace",
  delete: "Delete",
  arrowup: "↑",
  arrowdown: "↓",
  arrowleft: "←",
  arrowright: "→",
  home: "Home",
  end: "End",
  pageup: "PageUp",
  pagedown: "PageDown",
};

/** "ctrl+shift+p" → "Ctrl+Shift+P" for display. */
export function formatCombo(combo: string): string {
  const parsed = parseCombo(combo);
  if (!parsed) return "";
  const parts: string[] = [];
  if (parsed.ctrl) parts.push("Ctrl");
  if (parsed.alt) parts.push("Alt");
  if (parsed.shift) parts.push("Shift");
  if (parsed.meta) parts.push("Meta");
  const k = parsed.key;
  parts.push(
    PRETTY_KEYS[k] ??
      (/^f\d{1,2}$/.test(k) ? k.toUpperCase() : k.length === 1 ? k.toUpperCase() : k),
  );
  return parts.join("+");
}

// ---- Binding resolution ----

export function defaultKeybindings(): Record<string, string> {
  const map: Record<string, string> = {};
  for (const c of KEY_COMMANDS) map[c.id] = c.default;
  return map;
}

/**
 * Effective bindings = defaults overridden by the user's stored map.
 * A stored "" unbinds; unknown command ids in storage are dropped (registry
 * is the source of truth for what CAN be bound).
 */
export function resolveKeybindings(stored: Record<string, string>): Record<string, string> {
  const merged = defaultKeybindings();
  for (const c of KEY_COMMANDS) {
    const v = stored[c.id];
    if (typeof v === "string") merged[c.id] = v;
  }
  return merged;
}

/** First command id bound to `combo` other than `exceptId`; null when free. */
export function findConflict(
  bindings: Record<string, string>,
  combo: string,
  exceptId: string,
): string | null {
  if (!combo) return null;
  for (const c of KEY_COMMANDS) {
    if (c.id !== exceptId && bindings[c.id] === combo) return c.id;
  }
  return null;
}

export function commandTitle(id: string): string {
  return KEY_COMMANDS.find((c) => c.id === id)?.title ?? id;
}

// ---- Dispatcher ----

export type KeymapHandlers = Record<string, () => void>;

let _handlers: KeymapHandlers = {};
// combo → command id, rebuilt whenever config changes.
let _lookup = new Map<string, string>();
// Suspension counter: the settings capture input suspends the dispatcher so
// pressing Ctrl+W while recording a shortcut doesn't close the tab.
let _suspended = 0;

function rebuildLookup(): void {
  _lookup = new Map();
  const bindings = resolveKeybindings(configStore.get("keybindings"));
  for (const [id, combo] of Object.entries(bindings)) {
    if (combo) _lookup.set(combo, id);
  }
}

/** Pause the global dispatcher (settings keybinding capture). Pair with resumeKeymap. */
export function suspendKeymap(): void {
  _suspended++;
}
export function resumeKeymap(): void {
  _suspended = Math.max(0, _suspended - 1);
}

/** Reset module state (tests). */
export function resetKeymapForTests(): void {
  _handlers = {};
  _suspended = 0;
  rebuildLookup();
}

export function initKeymap(handlers: KeymapHandlers): void {
  _handlers = handlers;
  rebuildLookup();
  configStore.subscribe((keys) => {
    if (keys.includes("keybindings")) rebuildLookup();
  });
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.isComposing) return;
      const combo = comboFromEvent(e);
      if (!combo) return;
      const blocked = BLOCKED_BROWSER_COMBOS.has(combo);
      // Settings key-capture suspends command dispatch but still wants the
      // OS print dialog suppressed if the user presses Ctrl+Shift+P.
      if (_suspended > 0) {
        if (blocked) e.preventDefault();
        return;
      }
      const id = _lookup.get(combo);
      const handler = id ? _handlers[id] : undefined;
      if (handler) {
        e.preventDefault();
        e.stopPropagation();
        handler();
        return;
      }
      if (blocked) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    true,
  );
}
