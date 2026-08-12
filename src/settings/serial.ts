// Settings — Serial panel
// Default baud rate, default serial profile, profile gallery.
// Per-device parameter memory is gone: named profiles (serial-profiles.json)
// replace it.
//
// lit-html migration (pilot: settings/ssh.ts): the panel renders from
// configStore + per-panel state through lit's diffing render(). Pending
// (unapplied) select values live in SerialPanelState, and profile-gallery
// cards are a keyed repeat() — re-renders after editor save/delete patch
// DOM instead of rebuilding it, so pending choices and node identity
// survive.

import {
  allSerialProfiles,
  DEFAULT_SERIAL_PROFILE,
  dedupeSerialProfileName,
  findSerialProfile,
  type SerialProfileDef,
} from "../config/serial-profiles";
import { SERIAL_BAUD_RATES } from "../core/common";
import { type ConfigState, configStore } from "../core/store";
import { html, itemRow, nothing, render, repeat, section, syncSelectValues } from "../ui/lit";
import { serialProfileSummary, showSerialProfileEditor } from "./serialprofileeditor";

// ---- Per-panel state -------------------------------------------------
// Pending (unapplied) select values. The store stays the source of truth;
// state is reset from it on Revert (refreshSerialPanel). Per panel element
// so a second Settings page never inherits another's pending choices.

interface SerialPanelState {
  baud: number;
  profile: string;
}

const panelStates = new WeakMap<HTMLElement, SerialPanelState>();

function stateOf(panel: HTMLElement): SerialPanelState {
  let st = panelStates.get(panel);
  if (!st) {
    st = { baud: configStore.get("serialBaud"), profile: configStore.get("serialProfile") };
    panelStates.set(panel, st);
  }
  return st;
}

export function createSerialPanel(): HTMLElement {
  const panel = document.createElement("div");
  panel.className = "settings-panel-content";
  panel.dataset.panel = "serial";
  panel.style.display = "none";
  renderSerialPanel(panel);
  return panel;
}

export function refreshSerialPanel(root: HTMLElement): void {
  // Accepts the settings page root (shell Revert) or the panel itself.
  const panel =
    root.dataset.panel === "serial"
      ? root
      : root.querySelector<HTMLElement>('.settings-panel-content[data-panel="serial"]');
  if (!panel) return;
  const st = stateOf(panel);
  st.baud = configStore.get("serialBaud"); // Revert drops the pending choices
  st.profile = configStore.get("serialProfile");
  renderSerialPanel(panel);
}

// ---- Rendering ---------------------------------------------------------

function renderSerialPanel(panel: HTMLElement): void {
  const st = stateOf(panel);
  // Keep the pending profile choice when valid, else fall back to Normal.
  if (!allSerialProfiles().some((p) => p.name === st.profile)) {
    st.profile = DEFAULT_SERIAL_PROFILE;
  }
  render(serialTemplate(panel, st), panel);
  syncSelectValues(panel);
}

function profileOptions(label: string, list: SerialProfileDef[]) {
  return html`<optgroup label=${label}>
    ${list.map((p) => html`<option value=${p.name}>${p.name}</option>`)}
  </optgroup>`;
}

function profileCard(panel: HTMLElement, p: SerialProfileDef) {
  // Card actions: duplicate any profile into a custom copy; custom
  // profiles can also be edited.
  return html`<div class="theme-card sp-card" data-profile=${p.name}>
    <div class="theme-card-name">${p.name}</div>
    <div class="sp-card-summary">${serialProfileSummary(p)}</div>
    <div class="theme-card-actions">
      <button
        class="theme-card-action"
        @click=${(e: MouseEvent) => {
          e.stopPropagation();
          openProfileEditor(panel, p, undefined);
        }}
      >Duplicate</button>
      ${
        p.source === "custom"
          ? html`<button
            class="theme-card-action"
            @click=${(e: MouseEvent) => {
              e.stopPropagation();
              openProfileEditor(panel, p, p.name);
            }}
          >Edit</button>`
          : nothing
      }
    </div>
  </div>`;
}

function serialTemplate(panel: HTMLElement, st: SerialPanelState) {
  const profiles = allSerialProfiles();
  const ofSource = (source: SerialProfileDef["source"]) =>
    profiles.filter((p) => p.source === source);

  return html`
    ${section(
      "Defaults",
      html`
        ${itemRow(
          "Default baud rate",
          "Baud rate for new serial sessions (8N1).",
          html`<select
            id="set-serial-baud"
            class="settings-select"
            data-current=${st.baud}
            @change=${(e: Event) => {
              st.baud = parseInt((e.target as HTMLSelectElement).value, 10) || 115200;
            }}
          >
            ${SERIAL_BAUD_RATES.map((b) => html`<option value=${b}>${b}</option>`)}
          </select>`,
        )}
        ${itemRow(
          "Default profile",
          "Input mode, newline handling and flow control for new serial sessions.",
          html`<select
            id="set-serial-profile"
            class="settings-select"
            data-current=${st.profile}
            @change=${(e: Event) => {
              st.profile = (e.target as HTMLSelectElement).value;
            }}
          >
            ${profileOptions("Built-in", ofSource("builtin"))}
            ${profileOptions("Custom", ofSource("custom"))}
          </select>`,
        )}
      `,
    )}
    ${section(
      "Profiles",
      html`
        <div class="settings-item-desc" style="margin-bottom:6px">Named session modes. Duplicate a built-in profile to customize it.</div>
        <div id="set-serial-profile-gallery" class="theme-gallery">
          <div class="theme-group-title">Built-in</div>
          <div class="theme-grid">
            ${repeat(
              ofSource("builtin"),
              (p) => p.name,
              (p) => profileCard(panel, p),
            )}
          </div>
          <div class="theme-group-title">Custom</div>
          <div class="theme-grid">
            ${repeat(
              ofSource("custom"),
              (p) => p.name,
              (p) => profileCard(panel, p),
            )}
            <button
              id="set-serial-profile-new"
              class="settings-link-btn"
              @click=${() =>
                openProfileEditor(panel, findSerialProfile(DEFAULT_SERIAL_PROFILE), undefined)}
            >+ New Profile</button>
          </div>
        </div>
      `,
    )}
  `;
}

// ---- Actions -----------------------------------------------------------

/** Open the profile editor and reconcile the gallery/default afterwards. */
function openProfileEditor(
  panel: HTMLElement,
  base: SerialProfileDef,
  editName: string | undefined,
): void {
  showSerialProfileEditor({
    base,
    editName,
    suggestedName: editName ?? dedupeSerialProfileName(`${base.name} Copy`),
    onSaved: (savedName) => {
      // Renaming the profile that is the global default: follow the new name.
      if (editName && configStore.get("serialProfile") === editName) {
        configStore.set({ serialProfile: savedName });
      }
      renderSerialPanel(panel);
    },
    onDeleted: (deletedName) => {
      // Deleted the default profile: fall back to Normal.
      if (configStore.get("serialProfile") === deletedName) {
        configStore.set({ serialProfile: DEFAULT_SERIAL_PROFILE });
      }
      renderSerialPanel(panel);
    },
  });
}

export function collectSerialSettings(root: HTMLElement): Partial<ConfigState> {
  const partial: Partial<ConfigState> = {};
  const baudEl = root.querySelector<HTMLSelectElement>("#set-serial-baud");
  const profileEl = root.querySelector<HTMLSelectElement>("#set-serial-profile");
  if (baudEl) partial.serialBaud = parseInt(baudEl.value, 10) || 115200;
  if (profileEl) partial.serialProfile = profileEl.value || DEFAULT_SERIAL_PROFILE;
  return partial;
}
