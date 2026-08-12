// Settings — Keyboard panel
// VS Code-style keybinding editor: searchable command table, click-to-record
// key capture, conflict detection, per-row reset. Edits accumulate in a
// pending map and only land in configStore via the footer's Apply button
// (collectShortcutsSettings); Revert re-reads the store (refreshShortcutsPanel).

import { configStore, type ConfigState } from "../core/store";
import {
  KEY_COMMANDS,
  defaultKeybindings,
  resolveKeybindings,
  comboFromEvent,
  formatCombo,
  findConflict,
  commandTitle,
  suspendKeymap,
  resumeKeymap,
} from "../core/keymap";

// Pending user overrides (same shape as the stored config). Null until the
// panel is first rendered; refresh() re-syncs from the store.
let _pending: Record<string, string> | null = null;

function effectiveBindings(): Record<string, string> {
  return resolveKeybindings(_pending ?? configStore.get("keybindings"));
}

function el(tag: string, className: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function markDirty(panel: HTMLElement): void {
  // The settings shell enables Apply on bubbled input/change events whose
  // target is an input/select — fire one from the panel's search input.
  panel.querySelector<HTMLInputElement>("#kb-search")
    ?.dispatchEvent(new Event("change", { bubbles: true }));
}

function setPending(panel: HTMLElement, commandId: string, combo: string): void {
  if (!_pending) _pending = { ...configStore.get("keybindings") };
  if ((_pending[commandId] ?? "") === combo) return;
  _pending[commandId] = combo;
  markDirty(panel);
}

function renderRows(panel: HTMLElement): void {
  const tbody = panel.querySelector<HTMLElement>("#kb-rows");
  if (!tbody) return;
  const query = panel.querySelector<HTMLInputElement>("#kb-search")?.value.trim().toLowerCase() ?? "";
  const bindings = effectiveBindings();
  const defaults = defaultKeybindings();
  tbody.textContent = "";

  for (const cmd of KEY_COMMANDS) {
    const combo = bindings[cmd.id] ?? "";
    const modified = combo !== defaults[cmd.id];
    const haystack = `${cmd.title} ${cmd.desc} ${cmd.id} ${formatCombo(combo)}`.toLowerCase();
    if (query && !query.split(/\s+/).every(w => haystack.includes(w))) continue;

    const row = el("div", "kb-row");

    const info = el("div", "kb-info");
    info.appendChild(el("div", "kb-title", cmd.title));
    info.appendChild(el("div", "kb-desc", cmd.desc));
    row.appendChild(info);

    const bindingCell = el("div", "kb-binding");
    const chip = document.createElement("button");
    chip.className = "kb-chip" + (combo ? "" : " kb-chip-empty") + (modified ? " kb-chip-modified" : "");
    chip.type = "button";
    chip.title = "Click to change keybinding";
    chip.textContent = combo ? formatCombo(combo) : "Unbound";
    chip.addEventListener("click", () => startCapture(panel, bindingCell, cmd.id));
    bindingCell.appendChild(chip);

    if (modified) {
      const reset = document.createElement("button");
      reset.className = "kb-reset";
      reset.textContent = "↺";
      reset.type = "button";
      reset.title = `Reset to default (${formatCombo(defaults[cmd.id]) || "Unbound"})`;
      reset.addEventListener("click", () => {
        setPending(panel, cmd.id, defaults[cmd.id]);
        renderRows(panel);
      });
      bindingCell.appendChild(reset);
    }
    row.appendChild(bindingCell);

    tbody.appendChild(row);
  }

  if (!tbody.children.length) {
    tbody.appendChild(el("div", "kb-empty", "No matching commands"));
  }
}

// Replace the chip with a capture input: the next non-modifier keydown is
// the new combo (displayed live), Enter commits, Escape/blur cancels,
// Backspace/Delete unbinds. A combo already bound elsewhere is refused.
function startCapture(panel: HTMLElement, cell: HTMLElement, commandId: string): void {
  const input = document.createElement("input");
  input.className = "kb-capture settings-input";
  input.placeholder = "Press desired key combination, then Enter";
  let combo: string | null = null;
  let conflict: string | null = null;
  let finished = false;

  const finish = (commit: boolean) => {
    if (finished) return;
    finished = true;
    resumeKeymap();
    if (commit && combo !== null && !conflict) {
      setPending(panel, commandId, combo);
    }
    renderRows(panel);
  };

  input.addEventListener("keydown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape") { finish(false); return; }
    if (e.key === "Enter") {
      if (combo !== null && !conflict) finish(true);
      else if (conflict) input.classList.add("kb-capture-shake");
      return;
    }
    // Backspace/Delete without modifiers = remove the binding.
    if ((e.key === "Backspace" || e.key === "Delete") && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) {
      combo = "";
      conflict = null;
      input.value = "Unbound";
      input.classList.remove("kb-capture-conflict");
      input.title = "";
      return;
    }
    const c = comboFromEvent(e);
    if (!c) return; // modifier-only press: wait for the key
    combo = c;
    conflict = findConflict(effectiveBindings(), c, commandId);
    input.value = formatCombo(c);
    input.classList.toggle("kb-capture-conflict", conflict !== null);
    input.title = conflict ? `Already bound to: ${commandTitle(conflict)}` : "";
  });
  input.addEventListener("blur", () => finish(false));

  suspendKeymap(); // recorded keys must not fire commands (e.g. Ctrl+W)
  cell.querySelector(".kb-chip")?.replaceWith(input);
  input.focus();
}

export function createShortcutsPanel(): HTMLElement {
  const panel = document.createElement("div");
  panel.className = "settings-panel-content";
  panel.dataset.panel = "keyboard";
  // Hidden until the sidebar selects it (every non-General panel does this;
  // without it the panel renders stacked over the General page on open).
  panel.style.display = "none";

  const section = el("div", "settings-section");
  section.appendChild(el("div", "settings-section-title", "Keyboard Shortcuts"));

  const hint = el("div", "settings-item-desc",
    "Click a keybinding to change it: press the new combination, Enter to confirm, Escape to cancel, Backspace to remove. Changes take effect with the Apply button below. Ctrl+D is deliberately not captured — it reaches the shell and ends the session (the tab then closes itself).");
  hint.style.marginBottom = "12px";
  section.appendChild(hint);

  const search = document.createElement("input");
  search.id = "kb-search";
  search.className = "settings-input kb-search";
  search.placeholder = "Search keybindings…";
  search.addEventListener("input", () => renderRows(panel));
  section.appendChild(search);

  const table = el("div", "kb-table");
  const head = el("div", "kb-row kb-row-head");
  head.appendChild(el("div", "kb-info", "Command"));
  head.appendChild(el("div", "kb-binding", "Keybinding"));
  table.appendChild(head);
  const rows = document.createElement("div");
  rows.id = "kb-rows";
  table.appendChild(rows);
  section.appendChild(table);

  panel.appendChild(section);
  renderRows(panel);
  return panel;
}

export function refreshShortcutsPanel(root: HTMLElement): void {
  _pending = { ...configStore.get("keybindings") };
  const panel = root.querySelector<HTMLElement>('[data-panel="keyboard"]');
  if (panel) {
    const search = panel.querySelector<HTMLInputElement>("#kb-search");
    if (search) search.value = "";
    renderRows(panel);
  }
}

export function collectShortcutsSettings(_root: HTMLElement): Partial<ConfigState> {
  if (!_pending) return {};
  const changed = JSON.stringify(_pending) !== JSON.stringify(configStore.get("keybindings"));
  const out = { ..._pending };
  _pending = null;
  return changed ? { keybindings: out } : {};
}
