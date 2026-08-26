// Settings — Keyboard panel
// VS Code-style keybinding editor: searchable command table, click-to-record
// key capture, conflict detection, per-row reset. Edits accumulate in a
// pending map and only land in configStore via the footer's Apply button
// (collectShortcutsSettings); Revert re-reads the store (refreshShortcutsPanel).
//
// lit-html panel: renders through lit-html's diffing render() from the
// pending map + per-panel state
// (search query, active capture). Rows are a keyed repeat, so typing in
// #kb-search patches the list instead of rebuilding it — the search input
// keeps focus, and the capture input survives the live combo/conflict
// updates of a recording.

import {
  comboFromEvent,
  commandTitle,
  defaultKeybindings,
  findConflict,
  formatCombo,
  KEY_COMMANDS,
  type KeyCommand,
  resolveKeybindings,
  resumeKeymap,
  suspendKeymap,
} from "../core/keymap";
import { type ConfigState, configStore } from "../core/store";
import { html, nothing, render, repeat, section } from "../ui/lit";

// Pending user overrides (same shape as the stored config). Null until the
// panel is first rendered; refresh() re-syncs from the store.
let _pending: Record<string, string> | null = null;

// ---- Per-panel state ---------------------------------------------------
// View/capture state only — the binding model stays in _pending. Per panel
// element so a second Settings page never inherits another's capture.

interface CaptureState {
  commandId: string;
  // Captured combo ("" = explicit unbind); null = nothing pressed yet.
  combo: string | null;
  // Command id the captured combo is already bound to; null = free.
  conflict: string | null;
  // Enter pressed while conflicted: shake the input, keep capturing.
  shake: boolean;
}

interface ShortcutsPanelState {
  query: string;
  recording: CaptureState | null;
}

const panelStates = new WeakMap<HTMLElement, ShortcutsPanelState>();

function stateOf(panel: HTMLElement): ShortcutsPanelState {
  let st = panelStates.get(panel);
  if (!st) {
    st = { query: "", recording: null };
    panelStates.set(panel, st);
  }
  return st;
}

function effectiveBindings(): Record<string, string> {
  return resolveKeybindings(_pending ?? configStore.get("keybindings"));
}

function markDirty(panel: HTMLElement): void {
  // Sanctioned settings-shell mechanism for non-native edits (same event
  // the appearance panel's font picker uses) — enables the footer Apply.
  panel.dispatchEvent(new CustomEvent("tterm-settings-changed", { bubbles: true }));
}

function setPending(panel: HTMLElement, commandId: string, combo: string): void {
  if (!_pending) _pending = { ...configStore.get("keybindings") };
  // Compare against the EFFECTIVE binding (defaults included): a command
  // with no stored override still has a default combo, and unbinding it
  // must be recorded as an explicit "" override.
  if ((effectiveBindings()[commandId] ?? "") === combo) return;
  _pending[commandId] = combo;
  markDirty(panel);
}

function renderPanel(panel: HTMLElement): void {
  render(shortcutsTemplate(panel), panel);
}

// ---- Capture (click-to-record) -----------------------------------------
// The chip swaps for a capture input: the next non-modifier keydown is the
// new combo (displayed live), Enter commits, Escape/blur cancels,
// Backspace/Delete unbinds. A combo already bound elsewhere is refused.

function startCapture(panel: HTMLElement, commandId: string): void {
  endCapture(panel, false); // one capture at a time
  const st = stateOf(panel);
  st.recording = { commandId, combo: null, conflict: null, shake: false };
  suspendKeymap(); // recorded keys must not fire commands (e.g. Ctrl+W)
  renderPanel(panel);
  panel.querySelector<HTMLInputElement>(".kb-capture")?.focus();
}

/** End the active capture (if any), committing on `commit`. Caller renders. */
function endCapture(panel: HTMLElement, commit: boolean): boolean {
  const st = stateOf(panel);
  const rec = st.recording;
  if (!rec) return false;
  st.recording = null;
  resumeKeymap();
  if (commit && rec.combo !== null && !rec.conflict) {
    setPending(panel, rec.commandId, rec.combo);
  }
  return true;
}

function onCaptureKeydown(panel: HTMLElement, e: KeyboardEvent): void {
  e.preventDefault();
  e.stopPropagation();
  const rec = stateOf(panel).recording;
  if (!rec) return;
  if (e.key === "Escape") {
    endCapture(panel, false);
    renderPanel(panel);
    return;
  }
  if (e.key === "Enter") {
    if (rec.combo !== null && !rec.conflict) {
      endCapture(panel, true);
    } else if (rec.conflict) {
      rec.shake = true; // refused: shake, keep capturing
    }
    renderPanel(panel);
    return;
  }
  // Backspace/Delete without modifiers = remove the binding.
  if (
    (e.key === "Backspace" || e.key === "Delete") &&
    !e.ctrlKey &&
    !e.altKey &&
    !e.shiftKey &&
    !e.metaKey
  ) {
    rec.combo = "";
    rec.conflict = null;
    renderPanel(panel);
    return;
  }
  const c = comboFromEvent(e);
  if (!c) return; // modifier-only press: wait for the key
  rec.combo = c;
  rec.conflict = findConflict(effectiveBindings(), c, rec.commandId);
  renderPanel(panel);
}

// ---- Rendering -----------------------------------------------------------

function shortcutsTemplate(panel: HTMLElement) {
  const st = stateOf(panel);
  const bindings = effectiveBindings();
  const defaults = defaultKeybindings();
  const query = st.query.trim().toLowerCase();
  const visible = KEY_COMMANDS.filter((cmd) => {
    if (!query) return true;
    const haystack =
      `${cmd.title} ${cmd.desc} ${cmd.id} ${formatCombo(bindings[cmd.id] ?? "")}`.toLowerCase();
    return query.split(/\s+/).every((w) => haystack.includes(w));
  });

  return section(
    "Keyboard Shortcuts",
    html`
      <div class="settings-item-desc kb-hint">Click a keybinding to change it. Search matches title, description, command id, and combo. Changes join the same Apply as other settings.</div>
      <input
        type="search"
        id="kb-search"
        class="kb-search"
        placeholder="Search keybindings…"
        autocomplete="off"
        .value=${st.query}
        @input=${(e: Event) => {
          st.query = (e.target as HTMLInputElement).value;
          renderPanel(panel);
        }}
      />
      <div class="kb-table">
        <div class="kb-row kb-row-head">
          <div class="kb-info">Command</div>
          <div class="kb-binding">Keybinding</div>
        </div>
        <div id="kb-rows">
          ${repeat(
            visible,
            (cmd) => cmd.id,
            (cmd) => rowTemplate(panel, st, cmd, bindings, defaults),
          )}
          ${visible.length === 0 ? html`<div class="kb-empty">No matching commands</div>` : nothing}
        </div>
      </div>
    `,
  );
}

function rowTemplate(
  panel: HTMLElement,
  st: ShortcutsPanelState,
  cmd: KeyCommand,
  bindings: Record<string, string>,
  defaults: Record<string, string>,
) {
  const combo = bindings[cmd.id] ?? "";
  const modified = combo !== defaults[cmd.id];
  const rec = st.recording?.commandId === cmd.id ? st.recording : null;
  return html`<div class="kb-row" data-command=${cmd.id}>
    <div class="kb-info">
      <div class="kb-title">${cmd.title}</div>
      <div class="kb-desc">${cmd.desc}</div>
    </div>
    <div class="kb-binding">
      ${
        rec
          ? html`<input
            class="kb-capture settings-input${rec.conflict ? " kb-capture-conflict" : ""}${rec.shake ? " kb-capture-shake" : ""}"
            placeholder="Press desired key combination, then Enter"
            .value=${rec.combo === null ? "" : rec.combo === "" ? "Unbound" : formatCombo(rec.combo)}
            title=${rec.conflict ? `Already bound to: ${commandTitle(rec.conflict)}` : ""}
            @keydown=${(e: KeyboardEvent) => onCaptureKeydown(panel, e)}
            @blur=${() => {
              // No-op when a commit render already detached the input.
              if (endCapture(panel, false)) renderPanel(panel);
            }}
          />`
          : html`<button
            class="kb-chip${combo ? "" : " kb-chip-empty"}${modified ? " kb-chip-modified" : ""}"
            type="button"
            title="Click to change keybinding"
            @click=${() => startCapture(panel, cmd.id)}
          >${combo ? formatCombo(combo) : "Unbound"}</button>`
      }
      ${
        modified
          ? html`<button
            class="kb-reset"
            type="button"
            title="Reset to default (${formatCombo(defaults[cmd.id]) || "Unbound"})"
            @click=${() => {
              endCapture(panel, false);
              setPending(panel, cmd.id, defaults[cmd.id]);
              renderPanel(panel);
            }}
          >↺</button>`
          : nothing
      }
    </div>
  </div>`;
}

export function createShortcutsPanel(): HTMLElement {
  const panel = document.createElement("div");
  panel.className = "settings-panel-content";
  panel.dataset.panel = "keyboard";
  // Hidden until the sidebar selects it (every non-General panel does this;
  // without it the panel renders stacked over the General page on open).
  panel.style.display = "none";
  renderPanel(panel);
  return panel;
}

export function refreshShortcutsPanel(root: HTMLElement): void {
  _pending = { ...configStore.get("keybindings") };
  const panel = root.querySelector<HTMLElement>('[data-panel="keyboard"]');
  if (!panel) return;
  const st = stateOf(panel);
  st.query = "";
  endCapture(panel, false); // an open capture is cancelled by the Revert
  renderPanel(panel);
}

export function collectShortcutsSettings(_root: HTMLElement): Partial<ConfigState> {
  if (!_pending) return {};
  const changed = JSON.stringify(_pending) !== JSON.stringify(configStore.get("keybindings"));
  const out = { ..._pending };
  _pending = null;
  return changed ? { keybindings: out } : {};
}
