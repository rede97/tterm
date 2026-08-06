// Settings — Serial panel
// Default baud rate, default serial profile, profile gallery.
// Per-device parameter memory is gone: named profiles (serial-profiles.json)
// replace it.

import { configStore, type ConfigState } from "../core/store";
import { SERIAL_BAUD_RATES, esc } from "../core/common";
import {
  allSerialProfiles,
  findSerialProfile,
  dedupeSerialProfileName,
  DEFAULT_SERIAL_PROFILE,
  type SerialProfileDef,
} from "../config/serial-profiles";
import { showSerialProfileEditor, serialProfileSummary } from "./serialprofileeditor";

export function createSerialPanel(): HTMLElement {
  const panel = document.createElement("div");
  panel.className = "settings-panel-content";
  panel.dataset.panel = "serial";
  panel.style.display = "none";
  panel.innerHTML = `
    <div class="settings-section">
      <div class="settings-section-title">Defaults</div>
      <div class="settings-item settings-item-row">
        <div class="settings-item-info">
          <div class="settings-item-title">Default baud rate</div>
          <div class="settings-item-desc">Baud rate for new serial sessions (8N1).</div>
        </div>
        <div class="settings-item-control">
          <select id="set-serial-baud" class="settings-select">${baudOptionsHtml(configStore.get("serialBaud"))}</select>
        </div>
      </div>
      <div class="settings-item settings-item-row">
        <div class="settings-item-info">
          <div class="settings-item-title">Default profile</div>
          <div class="settings-item-desc">Input mode, newline handling and flow control for new serial sessions.</div>
        </div>
        <div class="settings-item-control">
          <select id="set-serial-profile" class="settings-select"></select>
        </div>
      </div>
    </div>
    <div class="settings-section">
      <div class="settings-section-title">Profiles</div>
      <div class="settings-item-desc" style="margin-bottom:6px">Named session modes. Duplicate a built-in profile to customize it.</div>
      <div id="set-serial-profile-gallery" class="theme-gallery"></div>
    </div>
  `;
  const baudEl = panel.querySelector<HTMLSelectElement>("#set-serial-baud")!;
  baudEl.value = String(configStore.get("serialBaud"));
  refreshProfileSelect(panel);
  renderProfileGallery(panel);
  return panel;
}

export function refreshSerialPanel(root: HTMLElement): void {
  const baudEl = root.querySelector<HTMLSelectElement>("#set-serial-baud");
  if (baudEl) baudEl.value = String(configStore.get("serialBaud"));
  refreshProfileSelect(root, configStore.get("serialProfile"));
  renderProfileGallery(root);
}

// Legacy name kept for src/settings/index.ts (Revert flow).
function baudOptionsHtml(current: number): string {
  return SERIAL_BAUD_RATES.map(b =>
    `<option value="${b}" ${current === b ? "selected" : ""}>${b}</option>`).join("");
}

function profileOptionsHtml(selected: string): string {
  const profiles = allSerialProfiles();
  const group = (label: string, list: SerialProfileDef[]): string =>
    `<optgroup label="${label}">` +
    list.map(p =>
      `<option value="${esc(p.name)}" ${p.name === selected ? "selected" : ""}>${esc(p.name)}</option>`).join("") +
    `</optgroup>`;
  return group("Built-in", profiles.filter(p => p.source === "builtin")) +
         group("Custom", profiles.filter(p => p.source === "custom"));
}

/** Rebuild the default-profile select, keeping the pending choice when valid. */
function refreshProfileSelect(root: HTMLElement, selected?: string): void {
  const sel = root.querySelector<HTMLSelectElement>("#set-serial-profile");
  if (!sel) return;
  const want = selected ?? (sel.value || configStore.get("serialProfile"));
  const valid = allSerialProfiles().some(p => p.name === want) ? want : DEFAULT_SERIAL_PROFILE;
  sel.innerHTML = profileOptionsHtml(valid);
  sel.value = valid;
}

export function renderProfileGallery(root: HTMLElement): void {
  const gallery = root.querySelector<HTMLElement>("#set-serial-profile-gallery");
  if (!gallery) return;
  gallery.innerHTML = "";

  const renderCard = (p: SerialProfileDef, grid: HTMLElement) => {
    const card = document.createElement("div");
    card.className = "theme-card sp-card";
    card.dataset.profile = p.name;

    const name = document.createElement("div");
    name.className = "theme-card-name";
    name.textContent = p.name;
    card.appendChild(name);

    const summary = document.createElement("div");
    summary.className = "sp-card-summary";
    summary.textContent = serialProfileSummary(p);
    card.appendChild(summary);

    // Card actions: duplicate any profile into a custom copy; custom
    // profiles can also be edited.
    const actions = document.createElement("div");
    actions.className = "theme-card-actions";
    const dupBtn = document.createElement("button");
    dupBtn.className = "theme-card-action";
    dupBtn.textContent = "Duplicate";
    dupBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openProfileEditor(root, p, undefined);
    });
    actions.appendChild(dupBtn);
    if (p.source === "custom") {
      const editBtn = document.createElement("button");
      editBtn.className = "theme-card-action";
      editBtn.textContent = "Edit";
      editBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        openProfileEditor(root, p, p.name);
      });
      actions.appendChild(editBtn);
    }
    card.appendChild(actions);
    grid.appendChild(card);
  };

  const profiles = allSerialProfiles();
  const builtin = profiles.filter(p => p.source === "builtin");
  const custom = profiles.filter(p => p.source === "custom");

  const builtinHeader = document.createElement("div");
  builtinHeader.className = "theme-group-title";
  builtinHeader.textContent = "Built-in";
  gallery.appendChild(builtinHeader);
  const builtinGrid = document.createElement("div");
  builtinGrid.className = "theme-grid";
  for (const p of builtin) renderCard(p, builtinGrid);
  gallery.appendChild(builtinGrid);

  // User's own profiles (serial-profiles.json) — always shown so the
  // affordance exists.
  const customHeader = document.createElement("div");
  customHeader.className = "theme-group-title";
  customHeader.textContent = "Custom";
  gallery.appendChild(customHeader);
  const customGrid = document.createElement("div");
  customGrid.className = "theme-grid";
  for (const p of custom) renderCard(p, customGrid);

  // "New Profile" — always starts from Normal's plain values.
  const newBtn = document.createElement("button");
  newBtn.id = "set-serial-profile-new";
  newBtn.className = "settings-link-btn";
  newBtn.textContent = "+ New Profile";
  newBtn.addEventListener("click", () => {
    openProfileEditor(root, findSerialProfile(DEFAULT_SERIAL_PROFILE), undefined);
  });
  customGrid.appendChild(newBtn);
  gallery.appendChild(customGrid);
}

/** Open the profile editor and reconcile the gallery/default afterwards. */
function openProfileEditor(root: HTMLElement, base: SerialProfileDef, editName: string | undefined): void {
  showSerialProfileEditor({
    base,
    editName,
    suggestedName: editName ?? dedupeSerialProfileName(`${base.name} Copy`),
    onSaved: (savedName) => {
      // Renaming the profile that is the global default: follow the new name.
      if (editName && configStore.get("serialProfile") === editName) {
        configStore.set({ serialProfile: savedName });
      }
      refreshProfileSelect(root);
      renderProfileGallery(root);
    },
    onDeleted: (deletedName) => {
      // Deleted the default profile: fall back to Normal.
      if (configStore.get("serialProfile") === deletedName) {
        configStore.set({ serialProfile: DEFAULT_SERIAL_PROFILE });
      }
      refreshProfileSelect(root);
      renderProfileGallery(root);
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
