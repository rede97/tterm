// Settings — Profile panel
// Default profile selection, WT profile visibility toggles

import { configStore, type ConfigState } from "../core/store";

export function createProfilePanel(): HTMLElement {
  const panel = document.createElement("div");
  panel.className = "settings-panel-content";
  panel.dataset.panel = "profile";
  panel.style.display = "none";
  renderProfilePanel(panel);
  return panel;
}

export function refreshProfilePanel(root: HTMLElement): void {
  renderProfilePanel(root);
}

function renderProfilePanel(container: HTMLElement) {
  const localProfiles = configStore.get("localProfiles");
  const hiddenProfiles = configStore.get("hiddenProfiles");

  container.innerHTML = `
    <div class="settings-section">
      <div class="settings-section-title">Default Profile</div>
      <div class="settings-item settings-item-row">
        <div class="settings-item-info">
          <div class="settings-item-title">Default Profile</div>
        </div>
        <div class="settings-item-control">
          <select id="set-default-profile" class="settings-select">
            ${localProfiles.map(p => `<option value="${esc(p.name)}">${esc(p.name)}</option>`).join("")}
          </select>
        </div>
      </div>
    </div>
    <div class="settings-section">
      <div class="settings-section-title">Imported from Windows Terminal</div>
      <div class="settings-item-desc" style="margin-bottom:10px">Toggle visibility of profiles imported from Windows Terminal. Uncheck to hide.</div>
      ${localProfiles.map(p => {
        const checked = !hiddenProfiles.includes(p.name);
        return `<label class="settings-item settings-item-row" style="cursor:pointer;margin-bottom:4px;background:#2a2a2a;border-radius:4px;padding:6px 10px;">
          <div class="settings-item-info">
            <div class="settings-item-title" style="margin-bottom:0;">${esc(p.name)}</div>
            <div class="settings-item-desc" style="margin-bottom:0;">${esc(p.command)}</div>
          </div>
          <div class="settings-item-control">
            <label class="settings-toggle-row" style="padding:0;gap:0;">
              <input type="checkbox" class="wt-profile-check" value="${esc(p.name)}" ${checked ? "checked" : ""} />
            </label>
          </div>
        </label>`;
      }).join("")}
    </div>
  `;
}

export function collectProfileSettings(root: HTMLElement): Partial<ConfigState> {
  const partial: Partial<ConfigState> = {};
  const profileEl = root.querySelector("#set-default-profile") as HTMLSelectElement;
  const checks = root.querySelectorAll<HTMLInputElement>(".wt-profile-check");
  if (profileEl && profileEl.options.length > 0) {
    partial.defaultLocalProfile = profileEl.value;
  }
  const hidden: string[] = [];
  checks.forEach(c => { if (!c.checked) hidden.push(c.value); });
  partial.hiddenProfiles = hidden;
  return partial;
}

export function refreshProfilePanelForm(root: HTMLElement): void {
  const profileEl = root.querySelector("#set-default-profile") as HTMLSelectElement;
  const checks = root.querySelectorAll<HTMLInputElement>(".wt-profile-check");
  if (profileEl && profileEl.options.length > 0) {
    profileEl.value = configStore.get("defaultLocalProfile") ?? configStore.get("localProfiles")[0]?.name ?? "";
  }
  const hiddenProfiles = configStore.get("hiddenProfiles");
  checks.forEach(c => {
    c.checked = !hiddenProfiles.includes(c.value);
  });
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
