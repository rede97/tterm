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
import { html, itemRow, nothing, render, repeat, section } from "../ui/lit";
import { syncSelectTexts, ttSelect } from "../ui/select";
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
  // Full clear + rebuild: a custom-select pick writes data-current
  // imperatively, and lit skips re-committing an attribute whose value is
  // unchanged since the last render — Revert/refresh must always land the
  // store values (same convention as the profile panel).
  render(nothing, panel);
  render(serialTemplate(panel, st), panel);
  syncSelectTexts(panel);
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
          ttSelect(
            "Default baud rate",
            SERIAL_BAUD_RATES.map((b) => [String(b), String(b)] as const),
            String(st.baud),
            (v) => {
              st.baud = parseInt(v, 10) || 115200;
            },
            { id: "set-serial-baud" },
          ),
        )}
        ${itemRow(
          "Default profile",
          "Input mode, newline handling and flow control for new serial sessions.",
          ttSelect(
            "Default profile",
            [],
            st.profile,
            (v) => {
              st.profile = v;
            },
            {
              id: "set-serial-profile",
              groups: (
                [
                  ["Built-in", ofSource("builtin")],
                  ["Custom", ofSource("custom")],
                ] as const
              )
                .map(([label, list]) => ({
                  label,
                  items: list.map((p) => [p.name, p.name] as const),
                }))
                .filter((g) => g.items.length > 0),
            },
          ),
        )}
      `,
    )}
    ${section(
      "Profiles",
      html`
        <div class="row-desc" style="margin-bottom:6px">Named session modes. Duplicate a built-in profile to customize it.</div>
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
              class="theme-new"
              @click=${() =>
                openProfileEditor(panel, findSerialProfile(DEFAULT_SERIAL_PROFILE), undefined)}
            >
              <span class="theme-new-label">+ New Profile</span>
              <span class="theme-new-hint">Start from Normal</span>
            </button>
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
  const baudEl = root.querySelector<HTMLElement>("#set-serial-baud");
  const profileEl = root.querySelector<HTMLElement>("#set-serial-profile");
  if (baudEl) partial.serialBaud = parseInt(baudEl.dataset.current ?? "", 10) || 115200;
  if (profileEl) partial.serialProfile = profileEl.dataset.current || DEFAULT_SERIAL_PROFILE;
  return partial;
}
