// lit-html single import point + the settings component vocabulary.
//
// Settings panels render through lit-html's part-diffing render(): DOM
// whose bindings didn't change is LEFT ALIVE — input focus, scroll
// position, and expansion state survive re-renders. This kills the
// keepPending-era hacks (full innerHTML rebuilds lost all three).
//
// Conventions for settings panels (the pilot is settings/ssh.ts):
// - Panel state (pending toggles, expansion, async lists) lives in a
//   per-panel state object; templates are pure functions of store + state.
// - Lists with identity use repeat(items, key, template) so drag-reorder
//   and delete patch DOM instead of rebuilding it.
// - Events bind in-template via @event — no querySelector wiring passes,
//   no listeners lost to re-renders, no inline handlers for CSP to block.
// - Whitespace between tags becomes real text nodes: templates whose DOM
//   is asserted via exact textContent (e2e does this) must keep the text
//   binding glued to its tags (`>text</button>`), not newline-indented.
// - Prefer in-handler busy guards over ?disabled on action buttons: a
//   pre-lit rebuild reset .disabled every render, so a click landing while
//   the button looks ready must invoke, not no-op.

export { html, noChange, nothing, render, type TemplateResult } from "lit-html";
export { ifDefined } from "lit-html/directives/if-defined.js";
export { repeat } from "lit-html/directives/repeat.js";

import { html, type TemplateResult } from "lit-html";
import { ifDefined } from "lit-html/directives/if-defined.js";

/** <div class="settings-section"> with a title; `titleEnd` right-aligns
 *  extra content (e.g. an "+ Add" button) inside the title row. */
export function section(title: string, body: unknown, titleEnd?: unknown): TemplateResult {
  return html`<div class="settings-section">
    <div class="settings-section-title ${titleEnd !== undefined ? "settings-section-title-row" : ""}">
      <span>${title}</span>
      ${titleEnd ?? ""}
    </div>
    ${body}
  </div>`;
}

/** Title + description on the left, control on the right. */
export function itemRow(title: string, desc: string, control: unknown): TemplateResult {
  return html`<div class="settings-item settings-item-row">
    <div class="settings-item-info">
      <div class="settings-item-title">${title}</div>
      <div class="settings-item-desc">${desc}</div>
    </div>
    <div class="settings-item-control">${control}</div>
  </div>`;
}

/** The settings toggle switch — the SAME control as the quick panel's
 *  (docs/quickpanel-preview.html): .qp-switch + .qp-knob, role="switch",
 *  skin-driven colors and transitions. Click propagation is stopped so a
 *  toggle inside a clickable row (e.g. an expandable card) doesn't
 *  trigger the row's own handler.
 *
 *  State flips in the DOM immediately: several panels collect from the
 *  element (aria-checked) and not every onChange re-renders. A later
 *  render re-asserts the same state from the model. */
export function toggle(
  checked: boolean,
  onChange: (checked: boolean) => void,
  opts?: { id?: string; value?: string; label?: string },
): TemplateResult {
  return html`<button
    type="button"
    class="qp-switch ${checked ? "on" : ""}"
    role="switch"
    id=${ifDefined(opts?.id)}
    value=${ifDefined(opts?.value)}
    aria-label=${ifDefined(opts?.label)}
    aria-checked=${checked ? "true" : "false"}
    @click=${(e: Event) => {
      e.stopPropagation();
      const btn = e.currentTarget as HTMLElement;
      const next = btn.getAttribute("aria-checked") !== "true";
      btn.classList.toggle("on", next);
      btn.setAttribute("aria-checked", next ? "true" : "false");
      onChange(next);
      // Non-native control: the settings shell tracks dirty state via this
      // bubbling event (its input/change delegation misses buttons).
      btn.dispatchEvent(new CustomEvent("tterm-settings-changed", { bubbles: true }));
    }}
  ><span class="qp-knob"></span></button>`;
}

/** The flat settings button. `danger` for destructive actions; `cls` adds
 *  a feature-specific marker class (used by tests and feature CSS). */
export function linkBtn(
  label: string,
  onClick: (e: MouseEvent) => void,
  opts?: { danger?: boolean; id?: string; title?: string; cls?: string },
): TemplateResult {
  return html`<button
    class="settings-link-btn ${opts?.danger ? "settings-link-btn-danger" : ""} ${opts?.cls ?? ""}"
    id=${ifDefined(opts?.id)}
    title=${ifDefined(opts?.title)}
    @click=${onClick}
  >
    ${label}
  </button>`;
}

/** Plain-info settings row (description only). */
export function infoRow(desc: string): TemplateResult {
  return html`<div class="settings-item">
    <div class="settings-item-desc">${desc}</div>
  </div>`;
}

/** <select> value binding convention. lit-html commits an element's
 * property parts BEFORE its child parts, so `.value=` on a <select> lands
 * before its <option>s exist and the browser snaps to the first option
 * (jsdom and spec-compliant browsers alike). The convention: put
 * `data-current=${value}` on the select instead of `.value=`, then call
 * syncSelectValues(root) immediately after every render(). Selects whose
 * value already matches (e.g. one with an open dropdown) are untouched. */
export function syncSelectValues(root: ParentNode): void {
  for (const sel of root.querySelectorAll<HTMLSelectElement>("select[data-current]")) {
    const current = sel.dataset.current ?? "";
    if (sel.value !== current) sel.value = current;
  }
}
