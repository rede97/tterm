// Shared custom select (design: no OS menu; one control family across the
// quick panel and Settings — docs/quickpanel-preview.html .qp-select,
// docs/settings-preview.html .set-select is the same control).
//
// Structure: [data-select] root > trigger(.qp-select-value) + menu
// (role=listbox, .qp-option[role=option][data-value][aria-selected],
// .qp-optgroup headers). Open/close state is DOM-only (the .open class) so
// lit re-renders never collapse an open menu; the picked value is written
// back to the trigger/aria-selected immediately, then onPick runs — any
// later re-render re-asserts the same state from the model.
//
// Trigger text NEVER rides the template: option picks write the span
// imperatively (a lit-bound text part would be ejected by that write), so
// the span starts empty and is synced via syncSelectTexts() after every
// render — same convention as the old syncSelectValues.

import { html, ifDefined, type TemplateResult } from "./lit";

export interface TtSelectGroup {
  label: string;
  items: readonly (readonly [string, string])[];
}

export function closeAllSelects(except?: Element): void {
  for (const root of document.querySelectorAll(".qp-select.open")) {
    if (root !== except) root.classList.remove("open");
  }
}

function pickOption(root: HTMLElement, opt: HTMLElement): void {
  for (const o of root.querySelectorAll(".qp-option")) {
    o.setAttribute("aria-selected", o === opt ? "true" : "false");
  }
  const valueEl = root.querySelector(".qp-select-value");
  if (valueEl) valueEl.textContent = opt.textContent;
  // Settings panels collect from this attribute (the shell's input/change
  // delegation misses custom controls).
  root.dataset.current = opt.dataset.value ?? "";
  root.classList.remove("open");
  // One funnel for mouse and keyboard picks; the template's own listener
  // turns it into onPick. The second event is the settings shell's dirty
  // signal (its input/change delegation misses buttons).
  root.dispatchEvent(
    new CustomEvent("tt-pick", { detail: opt.dataset.value ?? "", bubbles: true }),
  );
  root.dispatchEvent(new CustomEvent("tterm-settings-changed", { bubbles: true }));
}

function onSelectTriggerClick(root: HTMLElement): void {
  const willOpen = !root.classList.contains("open");
  closeAllSelects();
  if (!willOpen) return;
  root.classList.add("open");
  // Flip upward when there is not enough room below (design: <180px).
  const menu = root.querySelector<HTMLElement>(".qp-select-menu");
  const trigger = root.querySelector<HTMLElement>(".qp-select-trigger");
  if (menu && trigger) {
    const spaceBelow = window.innerHeight - trigger.getBoundingClientRect().bottom;
    menu.dataset.drop = spaceBelow < 180 ? "up" : "down";
  }
}

function onSelectKeydown(root: HTMLElement, e: KeyboardEvent): void {
  const options = [...root.querySelectorAll<HTMLElement>(".qp-option")];
  if (options.length === 0) return;
  const open = root.classList.contains("open");
  const activeIdx = options.findIndex((o) => o.classList.contains("active"));
  if (e.key === "Escape" && open) {
    e.preventDefault();
    e.stopPropagation(); // don't close the surrounding panel/dialog
    root.classList.remove("open");
    root.querySelector<HTMLElement>(".qp-select-trigger")?.focus();
    return;
  }
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    if (!open) {
      onSelectTriggerClick(root);
      return;
    }
    const opt = activeIdx >= 0 ? options[activeIdx] : null;
    if (opt) pickOption(root, opt);
    return;
  }
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    if (!open) {
      onSelectTriggerClick(root);
      return;
    }
    const delta = e.key === "ArrowDown" ? 1 : -1;
    const next = activeIdx < 0 ? 0 : (activeIdx + delta + options.length) % options.length;
    for (const [i, o] of options.entries()) o.classList.toggle("active", i === next);
    options[next]?.scrollIntoView({ block: "nearest" });
  }
}

export function ttSelect(
  label: string,
  options: readonly (readonly [string, string])[],
  current: string,
  onPick: (value: string) => void,
  opts?: {
    descs?: Record<string, string>;
    disabled?: boolean;
    groups?: TtSelectGroup[];
    id?: string;
  },
): TemplateResult {
  const disabled = opts?.disabled ?? false;
  const option = ([value, text]: readonly [string, string]): TemplateResult => html`
    <button
      type="button"
      class="qp-option"
      role="option"
      data-value=${value}
      title=${ifDefined(opts?.descs?.[value])}
      aria-selected=${value === current ? "true" : "false"}
      @click=${(e: Event) => {
        e.stopPropagation();
        const root = (e.currentTarget as HTMLElement).closest<HTMLElement>(".qp-select");
        if (root) pickOption(root, e.currentTarget as HTMLElement);
      }}
    >${text}</button>
  `;
  const menuBody = opts?.groups
    ? opts.groups.map(
        (g) => html`
          <div class="qp-optgroup">${g.label}</div>
          ${g.items.map(option)}
        `,
      )
    : options.map(option);
  const currentText =
    options.find(([v]) => v === current)?.[1] ??
    opts?.groups?.flatMap((g) => g.items).find(([v]) => v === current)?.[1] ??
    current;
  return html`
    <div
      class="qp-select ${disabled ? "qp-disabled" : ""}"
      id=${ifDefined(opts?.id)}
      data-select=${ifDefined(opts?.id)}
      data-current=${current}
      aria-label=${label}
      @tt-pick=${(e: CustomEvent<string>) => onPick(e.detail)}
      @keydown=${(e: KeyboardEvent) => {
        if (!disabled) onSelectKeydown(e.currentTarget as HTMLElement, e);
      }}
    >
      <button
        type="button"
        class="qp-select-trigger"
        aria-haspopup="listbox"
        ?disabled=${disabled}
        @click=${(e: Event) => {
          e.stopPropagation();
          const root = (e.currentTarget as HTMLElement).parentElement;
          if (!disabled && root) onSelectTriggerClick(root);
        }}
      ><span class="qp-select-value" data-current-text=${currentText}></span></button>
      <div class="qp-select-menu" role="listbox">
        ${menuBody}
      </div>
    </div>
  `;
}

/** Sync trigger texts after every render (see module header). */
export function syncSelectTexts(root: ParentNode): void {
  for (const span of root.querySelectorAll<HTMLElement>(".qp-select-value[data-current-text]")) {
    const text = span.dataset.currentText ?? "";
    if (span.textContent !== text) span.textContent = text;
  }
}
