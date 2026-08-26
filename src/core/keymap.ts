// Keyboard shortcut dispatcher — binds KEY_COMMANDS (see ./commands) to
// handlers and intercepts keydowns. Registry / combo helpers are re-exported
// from ./commands so existing `from "../core/keymap"` imports keep working.
//
//  - User overrides live in configStore "keybindings": { [commandId]: combo }.
//  - One window-level keydown listener in the CAPTURE phase intercepts bound
//    combos before xterm's textarea sees them (xterm would otherwise eat
//    Ctrl+W / Ctrl+Tab as terminal input).
//  - Handlers are injected by main.ts (setKeymapHandlers) so this module
//    never imports TabManager — same acyclic pattern as quickpanel.ts.

import { configStore } from "./store";
import {
  BLOCKED_BROWSER_COMBOS,
  comboFromEvent,
  resolveKeybindings,
} from "./commands";

export {
  type KeyCommand,
  type ParsedCombo,
  KEY_COMMANDS,
  BLOCKED_BROWSER_COMBOS,
  comboFromEvent,
  parseCombo,
  comboMatches,
  formatCombo,
  defaultKeybindings,
  resolveKeybindings,
  findConflict,
  commandTitle,
} from "./commands";

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

/** Run a registered command by id — the command palette's entry point.
 *  No-op for unknown ids or commands without an injected handler. */
export function runCommand(id: string): void {
  _handlers[id]?.();
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
