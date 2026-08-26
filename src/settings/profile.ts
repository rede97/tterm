// Settings — Profile panel (lit-html)
// Default profile selection, WT profile visibility toggles.
//
// lit-html panel: renders through lit-html's diffing render() straight from the store — no
// per-panel state, pending edits live in the DOM until Apply and a Revert
// re-render resets them.

import { type ConfigState, configStore } from "../core/store";
import { html, itemRow, nothing, render, repeat, section } from "../ui/lit";
import { syncSelectTexts, ttSelect } from "../ui/select";

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
        itemRow(
          "Default Profile",
          "Used when opening a new local tab.",
          ttSelect(
            "Default Profile",
            localProfiles.map((p) => [p.name, p.name] as const),
            defaultProfile,
            () => {
              // Pending lives in the DOM (data-current) until Apply —
              // same contract the native select had.
            },
            { id: "set-default-profile" },
          ),
        ),
      )}
      ${section(
        "Imported from Windows Terminal",
        html`
          <div class="settings-item-desc" style="margin-bottom:10px">
            Checkbox on the left — shown in the new-tab menu when checked (same
            pattern as SSH hosts). Pending until Apply.
          </div>
          ${repeat(
            localProfiles,
            (p) => p.name,
            (p) => html`<div class="check-row ${hiddenProfiles.includes(p.name) ? "is-off" : ""}">
              <label class="check-hit">
                <input
                  type="checkbox"
                  class="check-box wt-profile-check"
                  value=${p.name}
                  title="Show in new-tab menu"
                  .checked=${!hiddenProfiles.includes(p.name)}
                  @change=${(e: Event) => {
                    const box = e.currentTarget as HTMLInputElement;
                    box.closest(".check-row")?.classList.toggle("is-off", !box.checked);
                  }}
                />
                <div class="check-main">
                  <div class="check-title">${p.name}</div>
                  <div class="check-meta">${p.command}</div>
                </div>
              </label>
            </div>`,
          )}
        `,
      )}
    `,
    panel,
  );
  syncSelectTexts(panel);
}

export function collectProfileSettings(root: HTMLElement): Partial<ConfigState> {
  const partial: Partial<ConfigState> = {};
  const profileEl = root.querySelector<HTMLElement>("#set-default-profile");
  const checks = root.querySelectorAll<HTMLInputElement>(".wt-profile-check");
  if (profileEl?.dataset.current) {
    partial.defaultLocalProfile = profileEl.dataset.current;
  }
  const hidden: string[] = [];
  checks.forEach((c) => {
    if (!c.checked) hidden.push(c.getAttribute("value") ?? "");
  });
  partial.hiddenProfiles = hidden;
  return partial;
}
