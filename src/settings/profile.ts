// Settings — Profile panel (lit-html)
// Default profile selection, WT profile visibility toggles.
//
// lit-html panel: renders through lit-html's diffing render() straight from the store — no
// per-panel state, pending edits live in the DOM until Apply and a Revert
// re-render resets them.

import { type ConfigState, configStore } from "../core/store";
import { html, nothing, render, repeat, section, syncSelectValues } from "../ui/lit";

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

function renderProfilePanel(panel: HTMLElement): void {
  const localProfiles = configStore.get("localProfiles");
  const hiddenProfiles = configStore.get("hiddenProfiles");
  // The select must OPEN on the configured default — an unmarked select
  // falls back to the first option and the next Apply silently rewrites
  // defaultLocalProfile to it.
  const defaultProfile = configStore.get("defaultLocalProfile") ?? localProfiles[0]?.name ?? "";

  // Full clear + rebuild: this panel has no per-panel state, so pending
  // edits live in the DOM only — and lit skips a property binding whose
  // new value equals the last committed one, even when the live DOM
  // diverged. Revert must always land the store values, so it rebuilds.
  render(nothing, panel);

  render(
    html`
      ${section(
        "Default Profile",
        html`<div class="settings-item settings-item-row">
          <div class="settings-item-info">
            <div class="settings-item-title">Default Profile</div>
          </div>
          <div class="settings-item-control">
            <select
              id="set-default-profile"
              class="settings-select"
              data-current=${defaultProfile}
            >
              ${localProfiles.map((p) => html`<option value=${p.name}>${p.name}</option>`)}
            </select>
          </div>
        </div>`,
      )}
      ${section(
        "Imported from Windows Terminal",
        html`
          <div class="settings-item-desc" style="margin-bottom:10px">
            Toggle visibility of profiles imported from Windows Terminal. Uncheck to hide.
          </div>
          ${repeat(
            localProfiles,
            (p) => p.name,
            (p) => html`<label
              class="settings-item settings-item-row"
              style="cursor:pointer;margin-bottom:4px;background:#2a2a2a;border-radius:4px;padding:6px 10px;"
            >
              <div class="settings-item-info">
                <div class="settings-item-title" style="margin-bottom:0;">${p.name}</div>
                <div class="settings-item-desc" style="margin-bottom:0;">${p.command}</div>
              </div>
              <div class="settings-item-control">
                <span class="settings-toggle-row settings-toggle-flush">
                  <input
                    type="checkbox"
                    class="wt-profile-check"
                    value=${p.name}
                    .checked=${!hiddenProfiles.includes(p.name)}
                  />
                </span>
              </div>
            </label>`,
          )}
        `,
      )}
    `,
    panel,
  );
  syncSelectValues(panel);
}

export function collectProfileSettings(root: HTMLElement): Partial<ConfigState> {
  const partial: Partial<ConfigState> = {};
  const profileEl = root.querySelector("#set-default-profile") as HTMLSelectElement;
  const checks = root.querySelectorAll<HTMLInputElement>(".wt-profile-check");
  if (profileEl && profileEl.options.length > 0) {
    partial.defaultLocalProfile = profileEl.value;
  }
  const hidden: string[] = [];
  checks.forEach((c) => {
    if (!c.checked) hidden.push(c.value);
  });
  partial.hiddenProfiles = hidden;
  return partial;
}
