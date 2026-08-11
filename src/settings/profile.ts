// Settings — Profile panel
// Default profile selection, WT profile visibility toggles

import { configStore, type ConfigState } from "../core/store";
import { esc } from "../core/common";

export function createProfilePanel(): HTMLElement {
  const panel = document.createElement("div");
  panel.className = "settings-panel-content";
  panel.dataset.panel = "profile";
  panel.style.display = "none";
  renderProfilePanel(panel);
  return panel;
}

// Panel-scoped re-render (same contract as refreshSshPanel): rebuilds the
// option/checkbox lists from the store, so Revert also picks up WT
// profiles that changed on disk — an in-place value refresh can't.
export function refreshProfilePanel(root: HTMLElement): void {
  const panel = root.querySelector<HTMLElement>('.settings-panel-content[data-panel="profile"]');
  if (panel) renderProfilePanel(panel);
}

function renderProfilePanel(container: HTMLElement) {
  const localProfiles = configStore.get("localProfiles");
  const hiddenProfiles = configStore.get("hiddenProfiles");
  // The select must OPEN on the configured default — an unmarked select
  // falls back to the first option and the next Apply silently rewrites
  // defaultLocalProfile to it.
  const defaultProfile = configStore.get("defaultLocalProfile") ?? localProfiles[0]?.name ?? "";

  container.innerHTML = `
    <div class="settings-section">
      <div class="settings-section-title">Default Profile</div>
      <div class="settings-item settings-item-row">
        <div class="settings-item-info">
          <div class="settings-item-title">Default Profile</div>
        </div>
        <div class="settings-item-control">
          <select id="set-default-profile" class="settings-select">
            ${localProfiles.map(p => `<option value="${esc(p.name)}" ${p.name === defaultProfile ? "selected" : ""}>${esc(p.name)}</option>`).join("")}
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

  // Set the value imperatively too: the `selected` attribute alone covers
  // browsers, but select value-from-attribute on innerHTML re-parse is a
  // known jsdom gap (and costs nothing in real engines).
  const sel = container.querySelector<HTMLSelectElement>("#set-default-profile");
  if (sel && sel.options.length > 0) sel.value = defaultProfile;
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

