// Command registry + key-combo helpers — single source of truth for palette
// titles/order/groups/defaults and Settings → Keyboard labels.
//
// Design (VS Code model, shrunk to fit):
//  - KEY_COMMANDS is the declarative registry: id, display title, default
//    binding ("" = unbound, e.g. Clear Terminal ships without a shortcut).
//  - `group` matches docs/command-palette-preview.html section headers; omit
//    to keep a command in Settings → Keyboard but out of the palette list
//    (MRU / Show Palette / default-profile New Tab).
//  - User overrides live in configStore "keybindings": { [commandId]: combo }.
//    An explicit "" override UNBINDS a command that has a default — merge is
//    plain {...defaults, ...stored}, never delete-on-empty.
//  - The live dispatcher lives in keymap.ts (needs configStore); this module
//    stays pure so design drafts can import it without the store.
//
// Combo grammar: lowercase, modifiers first in ctrl+alt+shift+meta order,
// key last: "ctrl+shift+p", "f11", "ctrl+tab". "" means unbound.
//
// WebView2/Chromium also ships document chrome shortcuts (Print, etc.). Those
// are never useful in a terminal and are blocked even when unbound — otherwise
// Ctrl+Shift+P opens the system print dialog.

export interface KeyCommand {
  id: string;
  /** Palette / Settings display title (draft wording). */
  title: string;
  desc: string;
  default: string;
  /** Palette section header; omit → Settings only, not listed in palette. */
  group?: string;
}

/** Registry order = palette order (Tab → … → Terminal → Window last). */
export const KEY_COMMANDS: readonly KeyCommand[] = [
  // ---- Tab ----
  {
    id: "tterm.newLocalTab",
    title: "New Local Tab",
    desc: "Open a local shell from the profile list.",
    default: "ctrl+t",
    group: "Tab",
  },
  {
    id: "tterm.newSshTab",
    title: "New SSH Tab",
    desc: "Open an SSH host from ~/.ssh/config.",
    default: "",
    group: "Tab",
  },
  {
    id: "tterm.newSerialTab",
    title: "New Serial Tab",
    desc: "Open a serial COM port.",
    default: "",
    group: "Tab",
  },
  {
    id: "tterm.tempSsh",
    title: "New SSH Temporary Tab",
    desc: "Connect without ~/.ssh/config. Host goes to connection history.",
    default: "",
    group: "Tab",
  },
  {
    id: "tterm.duplicateTab",
    title: "Duplicate Tab",
    desc: "Duplicate the active tab's session.",
    default: "",
    group: "Tab",
  },
  {
    id: "workbench.action.closeTab",
    title: "Close Tab",
    desc: "Close the active tab (kills its session).",
    default: "ctrl+w",
    group: "Tab",
  },
  {
    id: "workbench.action.quickOpen",
    title: "Go to Tab…",
    desc: "Show a searchable list of all tabs; type a number or name to jump.",
    default: "ctrl+p",
    group: "Tab",
  },
  // ---- View ----
  {
    id: "tterm.toggleQuickPanel",
    title: "Toggle Quick Panel",
    desc: "Open the session quick panel (share, reconnect, parameters).",
    default: "",
    group: "View",
  },
  {
    id: "workbench.action.toggleFullScreen",
    title: "Toggle Full Screen",
    desc: "Browser-style full screen: covers the taskbar, tab bar hidden — terminal content only.",
    default: "f11",
    group: "View",
  },
  {
    id: "workbench.action.toggleZenMode",
    title: "Toggle Zen Mode",
    desc: "Maximize the window and hide the tab bar (stays above the taskbar, unlike Full Screen).",
    default: "shift+f11",
    group: "View",
  },
  {
    id: "workbench.action.openSettings",
    title: "Open Settings",
    desc: "Open the Settings tab.",
    default: "ctrl+,",
    group: "View",
  },
  // ---- Share ----
  {
    id: "tterm.shareStart",
    title: "Share with AI",
    desc: "Share the active session with the AI hub.",
    default: "",
    group: "Share",
  },
  {
    id: "tterm.shareStop",
    title: "Stop Sharing",
    desc: "Stop sharing the active session with the AI hub.",
    default: "",
    group: "Share",
  },
  // ---- SSH ----
  {
    id: "tterm.forwardAddLocal",
    title: "SSH: Add Local Port Forward…",
    desc: "Add a local (-L) port forward: listen here, dial from the remote.",
    default: "",
    group: "SSH",
  },
  {
    id: "tterm.forwardAddRemote",
    title: "SSH: Add Remote Port Forward…",
    desc: "Add a remote (-R) port forward: listen on the remote, dial from here.",
    default: "",
    group: "SSH",
  },
  {
    id: "tterm.forwardAddDynamic",
    title: "SSH: Add Dynamic (SOCKS) Forward…",
    desc: "Add a dynamic (-D) SOCKS5 proxy forward listening here.",
    default: "",
    group: "SSH",
  },
  {
    id: "tterm.forwardRemoveAll",
    title: "SSH: Remove All Port Forwards",
    desc: "Remove every port forward of the active embedded-SSH session.",
    default: "",
    group: "SSH",
  },
  {
    id: "tterm.sshAutoReconnect",
    title: "SSH: Toggle Auto-reconnect",
    desc: "Toggle timed auto-reconnect for the active SSH session.",
    default: "",
    group: "SSH",
  },
  {
    id: "tterm.clearSshTempHistory",
    title: "Clear SSH Temporary History",
    desc: "Clear New SSH Temporary Tab connection history (ssh-history.json). Passwords are never stored.",
    default: "",
    group: "SSH",
  },
  // ---- Serial ----
  {
    id: "tterm.serialProfile",
    title: "Serial: Set Profile…",
    desc: "Switch the active serial session's profile (input mode, newlines, flow).",
    default: "",
    group: "Serial",
  },
  {
    id: "tterm.serialBaud",
    title: "Serial: Set Baud Rate…",
    desc: "Change the active serial session's baud rate.",
    default: "",
    group: "Serial",
  },
  {
    id: "tterm.serialFlow",
    title: "Serial: Set Flow Control…",
    desc: "Change the active serial session's flow control.",
    default: "",
    group: "Serial",
  },
  {
    id: "tterm.serialInputMode",
    title: "Serial: Set Input Mode…",
    desc: "Change the active serial session's input mode (normal / line).",
    default: "",
    group: "Serial",
  },
  {
    id: "tterm.serialDisconnect",
    title: "Serial: Disconnect",
    desc: "Disconnect the active serial session (keeps the tab).",
    default: "",
    group: "Serial",
  },
  {
    id: "tterm.serialReconnect",
    title: "Serial: Reconnect",
    desc: "Reconnect the active serial session.",
    default: "",
    group: "Serial",
  },
  {
    id: "tterm.serialAutoReconnect",
    title: "Serial: Toggle Auto-reconnect",
    desc: "Toggle timed auto-reconnect for the active serial session.",
    default: "",
    group: "Serial",
  },
  // ---- Terminal ----
  {
    id: "workbench.action.terminal.clear",
    title: "Terminal: Clear",
    desc: "Clear the terminal screen and scrollback. Unbound by default.",
    default: "",
    group: "Terminal",
  },
  // ---- Window (lowest priority — last in palette) ----
  {
    id: "tterm.newWindow",
    title: "New Window",
    desc: "Open a new TTerm window.",
    default: "ctrl+shift+n",
    group: "Window",
  },
  {
    id: "tterm.closeWindow",
    title: "Close Window",
    desc: "Close this TTerm window.",
    default: "",
    group: "Window",
  },
  // ---- Settings / MRU only (no palette group) ----
  {
    id: "workbench.action.showCommands",
    title: "Show Command Palette…",
    desc: "Open the > command palette (New Tab, SSH, Serial, Share, and other actions).",
    default: "ctrl+shift+p",
  },
  {
    id: "workbench.action.nextTab",
    title: "Open Next Tab (hold Ctrl)",
    desc: "Show the tab list and step forward; releasing Ctrl switches.",
    default: "ctrl+tab",
  },
  {
    id: "workbench.action.prevTab",
    title: "Open Previous Tab (hold Ctrl)",
    desc: "Show the tab list and step backward; releasing Ctrl switches.",
    default: "ctrl+shift+tab",
  },
  {
    id: "workbench.action.newTab",
    title: "New Tab (default profile)",
    desc: "Open a new local tab with the default profile (no picker).",
    default: "",
  },
  {
    id: "tterm.portForwards",
    title: "SSH: Port Forwarding…",
    desc: "Manage port forwards for the active embedded-SSH session.",
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
