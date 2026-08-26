// Settings — Serial panel
// Default baud / frame (8N1·8E1·8O1), default serial profile via gallery cards.
// Per-device parameter memory is gone: named profiles (serial-profiles.json)
// replace it.
//
// lit-html migration (pilot: settings/ssh.ts): the panel renders from
// configStore + per-panel state through lit's diffing render(). Pending
// (unapplied) select values live in SerialPanelState, and profile-gallery
// cards are a keyed repeat() — re-renders after editor save/delete patch
// DOM instead of rebuilding it, so pending choices and node identity
// survive.

import { Copy, createElement } from "lucide";
import {
  allSerialProfiles,
  DEFAULT_SERIAL_PROFILE,
  dedupeSerialProfileName,
  findSerialProfile,
  type SerialProfileDef,
} from "../config/serial-profiles";
import { SERIAL_BAUD_RATES, SERIAL_FRAMES } from "../core/common";
import { type ConfigState, configStore } from "../core/store";
import type { SerialFrame } from "../core/types";
import { html, itemRow, nothing, render, repeat, section } from "../ui/lit";
import { syncSelectTexts, ttSelect } from "../ui/select";
import { serialProfileSummary, showSerialProfileEditor } from "./serialprofileeditor";

// ---- Per-panel state -------------------------------------------------
// Pending (unapplied) select values. The store stays the source of truth;
// state is reset from it on Revert (refreshSerialPanel). Per panel element
// so a second Settings page never inherits another's pending choices.

interface SerialPanelState {
  baud: number;
  frame: SerialFrame;
  profile: string;
}

const panelStates = new WeakMap<HTMLElement, SerialPanelState>();

function asFrame(v: string): SerialFrame {
  return v === "8E1" || v === "8O1" ? v : "8N1";
}

function stateOf(panel: HTMLElement): SerialPanelState {
  let st = panelStates.get(panel);
  if (!st) {
    st = {
      baud: configStore.get("serialBaud"),
      frame: asFrame(configStore.get("serialFrame")),
      profile: configStore.get("serialProfile"),
    };
    panelStates.set(panel, st);
  }
  return st;
}

function findSerialPanel(root: HTMLElement): HTMLElement | null {
  if (root.dataset.panel === "serial") return root;
  return root.querySelector<HTMLElement>('.settings-panel-content[data-panel="serial"]');
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
  const panel = findSerialPanel(root);
  if (!panel) return;
  const st = stateOf(panel);
  st.baud = configStore.get("serialBaud"); // Revert drops the pending choices
  st.frame = asFrame(configStore.get("serialFrame"));
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

function profileCard(panel: HTMLElement, p: SerialProfileDef, current: string) {
  // Card actions: duplicate any profile into a custom copy; custom
  // profiles can also be edited. Card body click sets the default
  // (same as Color Scheme gallery).
  return html`<div
    class="theme-card sp-card ${p.name === current ? "selected" : ""}"
    role="button"
    tabindex="0"
    aria-pressed=${p.name === current ? "true" : "false"}
    data-profile=${p.name}
    @click=${() => selectProfile(panel, p.name)}
    @keydown=${(e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        selectProfile(panel, p.name);
      }
    }}
  >
    <div class="theme-card-name">${p.name}</div>
    <div class="sp-card-summary">${serialProfileSummary(p)}</div>
    <div class="theme-card-actions">
      <button
        class="theme-card-action theme-card-action-icon"
        aria-label="Duplicate"
        title="Duplicate"
        @click=${(e: MouseEvent) => {
          e.stopPropagation();
          openProfileEditor(panel, p, undefined);
        }}
      >${createElement(Copy, { stroke: "currentColor", width: 14, height: 14 })}</button>
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
          "Baud rate for new serial sessions.",
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
          "Data / parity / stop",
          "Frame for new serial sessions.",
          ttSelect(
            "Data / parity / stop",
            SERIAL_FRAMES,
            st.frame,
            (v) => {
              st.frame = asFrame(v);
              renderSerialPanel(panel);
              panel.dispatchEvent(new CustomEvent("tterm-settings-changed", { bubbles: true }));
            },
            { id: "set-serial-frame" },
          ),
        )}
      `,
    )}
    ${section(
      "Profiles",
      html`
        <div class="row-desc" style="margin-bottom:6px">Named session modes. Click a card to set the default; Duplicate a built-in to customize.</div>
        <div id="set-serial-profile-gallery" class="theme-gallery">
          <div class="theme-group-title">Built-in</div>
          <div class="theme-grid">
            ${repeat(
              ofSource("builtin"),
              (p) => p.name,
              (p) => profileCard(panel, p, st.profile),
            )}
          </div>
          <div class="theme-group-title">Custom</div>
          <div class="theme-grid">
            ${repeat(
              ofSource("custom"),
              (p) => p.name,
              (p) => profileCard(panel, p, st.profile),
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

/** Gallery card — pending default profile until Apply. */
function selectProfile(panel: HTMLElement, name: string): void {
  const st = stateOf(panel);
  if (st.profile === name) return;
  st.profile = name;
  renderSerialPanel(panel);
  panel.dispatchEvent(new CustomEvent("tterm-settings-changed", { bubbles: true }));
}

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
      const st = stateOf(panel);
      // Renaming the profile that is the pending / applied default: follow.
      if (editName && (st.profile === editName || configStore.get("serialProfile") === editName)) {
        st.profile = savedName;
        if (configStore.get("serialProfile") === editName) {
          configStore.set({ serialProfile: savedName });
        }
      }
      renderSerialPanel(panel);
    },
    onDeleted: (deletedName) => {
      const st = stateOf(panel);
      // Deleted the default profile: fall back to Normal.
      if (st.profile === deletedName || configStore.get("serialProfile") === deletedName) {
        st.profile = DEFAULT_SERIAL_PROFILE;
        if (configStore.get("serialProfile") === deletedName) {
          configStore.set({ serialProfile: DEFAULT_SERIAL_PROFILE });
        }
      }
      renderSerialPanel(panel);
    },
  });
}

export function collectSerialSettings(root: HTMLElement): Partial<ConfigState> {
  const panel = findSerialPanel(root);
  const partial: Partial<ConfigState> = {};
  if (!panel) return partial;
  const st = stateOf(panel);
  const baudEl = panel.querySelector<HTMLElement>("#set-serial-baud");
  const frameEl = panel.querySelector<HTMLElement>("#set-serial-frame");
  if (baudEl) partial.serialBaud = parseInt(baudEl.dataset.current ?? "", 10) || st.baud;
  if (frameEl) partial.serialFrame = asFrame(frameEl.dataset.current ?? st.frame);
  partial.serialProfile = st.profile || DEFAULT_SERIAL_PROFILE;
  return partial;
}
