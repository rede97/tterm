// Settings — Profile panel (lit-html)
// Default profile selection, WT profile visibility toggles.
//
// lit-html panel: renders through lit-html's diffing render() straight from the store — no
// per-panel state, pending edits live in the DOM until Apply and a Revert
// re-render resets them.

import { type ConfigState, configStore } from "../core/store";
import { html, nothing, render, repeat, section } from "../ui/lit";
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
        html`<div class="settings-item settings-item-row">
          <div class="settings-item-info">
            <div class="settings-item-title">Default Profile</div>
          </div>
          <div class="settings-item-control">
            ${ttSelect(
              "Default Profile",
              localProfiles.map((p) => [p.name, p.name] as const),
              defaultProfile,
              () => {
                // Pending lives in the DOM (data-current) until Apply —
                // same contract the native select had.
              },
              { id: "set-default-profile" },
            )}
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
                <button
                  type="button"
                  class="qp-switch wt-profile-check ${hiddenProfiles.includes(p.name) ? "" : "on"}"
                  role="switch"
                  value=${p.name}
                  aria-label=${`Show ${p.name}`}
                  aria-checked=${hiddenProfiles.includes(p.name) ? "false" : "true"}
                  @click=${(e: Event) => {
                    e.stopPropagation();
                    const btn = e.currentTarget as HTMLElement;
                    const next = btn.getAttribute("aria-checked") !== "true";
                    btn.classList.toggle("on", next);
                    btn.setAttribute("aria-checked", next ? "true" : "false");
                    btn.dispatchEvent(new CustomEvent("tterm-settings-changed", { bubbles: true }));
                  }}
                ><span class="qp-knob"></span></button>
              </div>
            </label>`,
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
  const checks = root.querySelectorAll<HTMLElement>(".wt-profile-check");
  if (profileEl?.dataset.current) {
    partial.defaultLocalProfile = profileEl.dataset.current;
  }
  const hidden: string[] = [];
  checks.forEach((c) => {
    if (c.getAttribute("aria-checked") !== "true") hidden.push(c.getAttribute("value") ?? "");
  });
  partial.hiddenProfiles = hidden;
  return partial;
}
