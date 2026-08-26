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
//
// Layout classes match docs/settings-preview.html (.section / .row).
// Controls use src/ui/kit (.tt-switch / .tt-btn*).

export { html, noChange, nothing, render, type TemplateResult } from "lit-html";
export { ifDefined } from "lit-html/directives/if-defined.js";
export { repeat } from "lit-html/directives/repeat.js";

import { html, type TemplateResult } from "lit-html";
import { ifDefined } from "lit-html/directives/if-defined.js";

/** <div class="section"> with a title; `titleEnd` right-aligns extra content. */
export function section(title: string, body: unknown, titleEnd?: unknown): TemplateResult {
  return html`<div class="section">
    <div class="section-title ${titleEnd !== undefined ? "section-title-row" : ""}">
      <span>${title}</span>
      ${titleEnd ?? ""}
    </div>
    ${body}
  </div>`;
}

/** Title + description on the left, control on the right (design .row well). */
export function itemRow(title: string, desc: string, control: unknown): TemplateResult {
  return html`<div class="row">
    <div class="row-info">
      <div class="row-title">${title}</div>
      <div class="row-desc">${desc}</div>
    </div>
    <div class="row-control">${control}</div>
  </div>`;
}

/** Shared toggle — .tt-switch + .tt-knob (kit). */
export function toggle(
  checked: boolean,
  onChange: (checked: boolean) => void,
  opts?: { id?: string; value?: string; label?: string },
): TemplateResult {
  return html`<button
    type="button"
    class="tt-switch ${checked ? "on" : ""}"
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
      btn.dispatchEvent(new CustomEvent("tterm-settings-changed", { bubbles: true }));
    }}
  ><span class="tt-knob"></span></button>`;
}

/** Action button — same footprint as selects (`.tt-btn-solid`). */
export function linkBtn(
  label: string,
  onClick: (e: MouseEvent) => void,
  opts?: { danger?: boolean; id?: string; title?: string; cls?: string },
): TemplateResult {
  const kind = opts?.danger ? "tt-btn-solid tt-btn-danger-fill" : "tt-btn-solid";
  return html`<button
    type="button"
    class="${kind} ${opts?.cls ?? ""}"
    id=${ifDefined(opts?.id)}
    title=${ifDefined(opts?.title)}
    @click=${onClick}
  >${label}</button>`;
}

/** Plain-info settings block (description only). */
export function infoRow(desc: string): TemplateResult {
  return html`<div class="row-block">
    <div class="row-desc">${desc}</div>
  </div>`;
}

/** <select> value binding convention — see module docs historically. */
export function syncSelectValues(root: ParentNode): void {
  for (const sel of root.querySelectorAll<HTMLSelectElement>("select[data-current]")) {
    const current = sel.dataset.current ?? "";
    if (sel.value !== current) sel.value = current;
  }
}
