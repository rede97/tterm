// Serial profile editor modal — create a custom profile from any existing
// one ("Duplicate") or edit an existing custom profile. Profiles persist in
// serial-profiles.json via config/serial-profiles.ts, never in config.json.
// Mirrors themeeditor.ts. Selects use the shared ttSelect (same family as
// Settings / quick panel — no native <select>).

import {
  allSerialProfiles,
  deleteSerialProfile,
  type SerialProfileDef,
  saveSerialProfile,
} from "../config/serial-profiles";
import {
  SERIAL_ENTER_NEWLINES,
  SERIAL_OUTPUT_NEWLINE_DESCS,
  SERIAL_OUTPUT_NEWLINES,
} from "../core/common";
import { logCatch } from "../core/errorlog";
import type { SerialFlowControl, SerialInputMode, SerialProfile } from "../core/types";
import { confirmDialog } from "../ui/confirm";
import { mustQuery } from "../ui/dom";
import { render } from "../ui/lit";
import { createModal } from "../ui/modal";
import { syncSelectTexts, ttSelect } from "../ui/select";
import { showToast } from "../ui/toast";

const INPUT_MODE_LABELS: [SerialInputMode, string][] = [
  ["normal", "Normal"],
  ["echo", "Echo"],
  ["line", "Line by Line"],
];

const FLOW_CONTROL_LABELS: [SerialFlowControl, string][] = [
  ["none", "None"],
  ["software", "Software XON-XOFF"],
  ["hardware", "Hardware RTS-CTS"],
];

export interface SerialProfileEditorOptions {
  // Profile the editor starts from (duplicate source, or the edited profile).
  base: SerialProfileDef;
  // Set when editing an existing custom profile (enables rename + delete).
  editName?: string;
  // Initial name for the copy (already deduped by the caller).
  suggestedName: string;
  onSaved: (savedName: string) => void;
  onDeleted?: (deletedName: string) => void;
}

/** One-line summary used on gallery cards. */
export function serialProfileSummary(p: SerialProfile): string {
  return `${p.inputMode} · Enter→${p.enterNewline.toUpperCase()} · out ${p.outputNewline} · flow ${p.flowControl}`;
}

export function showSerialProfileEditor(opts: SerialProfileEditorOptions): void {
  const working: SerialProfile = {
    name: opts.base.name,
    inputMode: opts.base.inputMode,
    enterNewline: opts.base.enterNewline,
    outputNewline: opts.base.outputNewline,
    flowControl: opts.base.flowControl,
  };

  const modal = createModal({ className: "sp-overlay" });
  const overlay = modal.overlay;
  const close = modal.close;

  overlay.innerHTML = `
    <div class="sp-dialog tt-scroll">
      <div class="sp-header">${opts.editName ? "Edit Profile" : "New Profile"}</div>
      <div class="sp-name-row">
        <span class="sp-label">Name</span>
        <input type="text" class="sp-name" value="" spellcheck="false" />
      </div>
      <div class="sp-row">
        <span class="sp-label">Input mode</span>
        <div class="sp-select-slot" data-field="inputMode"></div>
      </div>
      <div class="sp-row">
        <span class="sp-label">Enter sends</span>
        <div class="sp-select-slot" data-field="enterNewline"></div>
      </div>
      <div class="sp-row">
        <span class="sp-label">Output newlines</span>
        <div class="sp-select-slot" data-field="outputNewline"></div>
      </div>
      <div class="sp-hint"></div>
      <div class="sp-row">
        <span class="sp-label">Flow control</span>
        <div class="sp-select-slot" data-field="flowControl"></div>
      </div>
      <div class="sp-footer">
        ${opts.editName ? `<button type="button" class="tt-btn tt-btn-danger sp-delete">Delete</button>` : ""}
        <span class="sp-spacer"></span>
        <button type="button" class="tt-btn tt-btn-ghost sp-cancel">Cancel</button>
        <button type="button" class="tt-btn tt-btn-primary sp-save">Save</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const nameInput = mustQuery<HTMLInputElement>(overlay, ".sp-name");
  nameInput.value = opts.suggestedName;
  const hint = mustQuery<HTMLElement>(overlay, ".sp-hint");

  const paintHint = (): void => {
    hint.textContent = SERIAL_OUTPUT_NEWLINE_DESCS[working.outputNewline] ?? "";
  };

  const mountSelect = (
    field: string,
    label: string,
    options: readonly (readonly [string, string])[],
    current: string,
    onPick: (v: string) => void,
    descs?: Record<string, string>,
  ): void => {
    const slot = mustQuery<HTMLElement>(overlay, `.sp-select-slot[data-field="${field}"]`);
    render(
      ttSelect(label, options, current, onPick, {
        id: `sp-${field}`,
        descs,
      }),
      slot,
    );
    syncSelectTexts(slot);
  };

  mountSelect("inputMode", "Input mode", INPUT_MODE_LABELS, working.inputMode, (v) => {
    working.inputMode = v as SerialInputMode;
  });
  mountSelect("enterNewline", "Enter sends", SERIAL_ENTER_NEWLINES, working.enterNewline, (v) => {
    working.enterNewline = v as SerialProfile["enterNewline"];
  });
  mountSelect(
    "outputNewline",
    "Output newlines",
    SERIAL_OUTPUT_NEWLINES,
    working.outputNewline,
    (v) => {
      working.outputNewline = v as SerialProfile["outputNewline"];
      paintHint();
    },
    SERIAL_OUTPUT_NEWLINE_DESCS,
  );
  mountSelect("flowControl", "Flow control", FLOW_CONTROL_LABELS, working.flowControl, (v) => {
    working.flowControl = v as SerialFlowControl;
  });
  paintHint();

  overlay.querySelector(".sp-cancel")?.addEventListener("click", close);
  overlay.querySelector(".sp-save")?.addEventListener("click", () => {
    const name = nameInput.value.trim();
    if (!name) {
      showToast("Profile name cannot be empty", "error");
      return;
    }
    const collision = allSerialProfiles().some((p) => p.name === name && p.name !== opts.editName);
    if (collision) {
      showToast(`A profile named "${name}" already exists`, "error");
      return;
    }
    saveSerialProfile({ ...working, name }, opts.editName)
      .then(() => {
        opts.onSaved(name);
        close();
      })
      .catch((e) => showToast(`Failed to save profile: ${e}`, "error"));
  });
  overlay.querySelector(".sp-delete")?.addEventListener("click", async () => {
    const editName = opts.editName;
    if (!editName) return;
    const confirmed = await confirmDialog({
      title: "Delete profile?",
      message: `Delete profile "${editName}"? This cannot be undone.`,
      okLabel: "Delete",
      danger: true,
    });
    if (!confirmed) return;
    deleteSerialProfile(editName)
      .then(() => {
        opts.onDeleted?.(editName);
        close();
      })
      .catch(logCatch("serialProfileEditor.delete"));
  });

  nameInput.focus();
  nameInput.select();
}
