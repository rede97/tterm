// Serial profile editor modal — create a custom profile from any existing
// one ("Duplicate") or edit an existing custom profile. Profiles persist in
// serial-profiles.json via config/serial-profiles.ts, never in config.json.
// Mirrors themeeditor.ts.

import {
  allSerialProfiles,
  deleteSerialProfile,
  type SerialProfileDef,
  saveSerialProfile,
} from "../config/serial-profiles";
import {
  esc,
  SERIAL_ENTER_NEWLINES,
  SERIAL_OUTPUT_NEWLINE_DESCS,
  SERIAL_OUTPUT_NEWLINES,
} from "../core/common";
import { logCatch } from "../core/errorlog";
import type { SerialFlowControl, SerialInputMode, SerialProfile } from "../core/types";
import { confirmDialog } from "../ui/confirm";
import { mustQuery } from "../ui/dom";
import { createModal } from "../ui/modal";
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

  const optionsHtml = <T extends string>(
    pairs: readonly [T, string][],
    current: T,
    descs?: Record<T, string>,
  ): string =>
    pairs
      .map(([v, label]) => {
        const title = descs ? ` title="${esc(descs[v])}"` : "";
        return `<option value="${v}"${title} ${v === current ? "selected" : ""}>${label}</option>`;
      })
      .join("");

  const rowHtml = (label: string, field: string, options: string): string => `
    <label class="sp-row">
      <span class="sp-label">${label}</span>
      <select class="sp-select" data-field="${field}">${options}</select>
    </label>`;

  const modal = createModal({ className: "sp-overlay" });
  const overlay = modal.overlay;
  overlay.innerHTML = `
    <div class="sp-dialog">
      <div class="sp-header">${opts.editName ? "Edit Profile" : "New Profile"}</div>
      <div class="sp-name-row">
        <span class="sp-label">Name</span>
        <input type="text" class="sp-name" value="${esc(opts.suggestedName)}" spellcheck="false" />
      </div>
      ${rowHtml("Input mode", "inputMode", optionsHtml(INPUT_MODE_LABELS, working.inputMode))}
      ${rowHtml("Enter sends", "enterNewline", optionsHtml(SERIAL_ENTER_NEWLINES, working.enterNewline))}
      ${rowHtml("Output newlines", "outputNewline", optionsHtml(SERIAL_OUTPUT_NEWLINES, working.outputNewline, SERIAL_OUTPUT_NEWLINE_DESCS))}
      <div class="sp-hint">${esc(SERIAL_OUTPUT_NEWLINE_DESCS[working.outputNewline])}</div>
      ${rowHtml("Flow control", "flowControl", optionsHtml(FLOW_CONTROL_LABELS, working.flowControl))}
      <div class="sp-footer">
        ${opts.editName ? `<button class="sp-btn sp-delete">Delete</button>` : ""}
        <span class="sp-spacer"></span>
        <button class="sp-btn sp-cancel">Cancel</button>
        <button class="sp-btn sp-save">Save</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const nameInput = mustQuery<HTMLInputElement>(overlay, ".sp-name");

  const hintEl = mustQuery(overlay, ".sp-hint");

  overlay.querySelectorAll<HTMLSelectElement>(".sp-select").forEach((el) => {
    const field = el.dataset.field as keyof Omit<SerialProfile, "name">;
    el.value = working[field];
    el.addEventListener("change", () => {
      (working[field] as string) = el.value;
      if (field === "outputNewline") {
        hintEl.textContent =
          SERIAL_OUTPUT_NEWLINE_DESCS[el.value as SerialProfile["outputNewline"]];
      }
    });
  });

  const close = modal.close;
  overlay.querySelector(".sp-cancel")?.addEventListener("click", close);

  overlay.querySelector(".sp-save")?.addEventListener("click", () => {
    const name = nameInput.value.trim();
    if (!name) {
      showToast("Profile name cannot be empty", "error");
      return;
    }
    // Name must not collide with a different profile.
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
