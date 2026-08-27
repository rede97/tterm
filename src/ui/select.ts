// Shared custom select (design: no OS menu; one control family across the
// quick panel and Settings — drafts/quickpanel-preview.html .tt-select,
// drafts/settings-preview.html .tt-select is the same control).
//
// Structure: [data-select] root > trigger(.tt-select-value) + menu
// (role=listbox, .tt-option[role=option][data-value][aria-selected],
// .tt-optgroup headers). Open/close state is DOM-only (the .open class) so
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
  for (const root of document.querySelectorAll(".tt-select.open")) {
    if (root !== except) root.classList.remove("open");
  }
  unportalMenu();
}

// Fixed menus don't track scrolling containers — close on any scroll
// outside the menu itself (the menu's own max-height scrolling exempt),
// and on window resize (same rule as the context menu).
document.addEventListener(
  "scroll",
  (e) => {
    if (e.target instanceof Element && e.target.closest(".tt-select-menu")) return;
    closeAllSelects();
  },
  true,
);
window.addEventListener("resize", () => closeAllSelects());
// Escape closes an open menu (design Q2: never the surrounding panel).
// CAPTURE phase: xterm's textarea stops key propagation at the target, so
// a bubble-phase listener never sees Escape while the terminal has focus.
window.addEventListener(
  "keydown",
  (e) => {
    if (e.key === "Escape") closeAllSelects();
  },
  true,
);

/** Pin the listbox to the trigger in VIEWPORT space: position:fixed means
 *  the menu never contributes to the panel's scrollHeight — opening a
 *  select must not spawn a panel scrollbar or shift the control column
 *  (design Q8, drafts/quickpanel-preview.html placeSelectMenu).
 *
 *  The menu is PORTALED to <body> while open: a backdrop-filtered panel
 *  (glass mode) becomes the containing block for fixed descendants, which
 *  would misplace the menu and let it grow the panel's scrollHeight. */
let portalReturn: { menu: HTMLElement; parent: Node; next: Node | null } | null = null;
// The currently open select (single-open rule) — the portaled menu no
// longer sits inside its root, so lookups go through this instead of
// closest()/querySelector.
let openSelect: { root: HTMLElement; menu: HTMLElement } | null = null;

// Portaled menus outlive a hidden trigger (Settings panel switch, page
// close, etc.). Watch at the control layer so callers never call
// closeAllSelects for lifecycle — only for explicit dismiss.
let triggerWatch: ResizeObserver | null = null;

function stopWatchingTrigger(): void {
  triggerWatch?.disconnect();
  triggerWatch = null;
}

function watchTrigger(trigger: HTMLElement): void {
  stopWatchingTrigger();
  // Skip the first callback: happy-dom/jsdom give 0×0 boxes, and a real
  // open must not self-close before layout. Collapse-to-zero after that
  // means an ancestor went display:none / was removed.
  let primed = false;
  triggerWatch = new ResizeObserver((entries) => {
    for (const e of entries) {
      const gone = e.contentRect.width === 0 && e.contentRect.height === 0;
      if (!primed) {
        primed = true;
        if (gone) return;
      }
      if (gone) closeAllSelects();
    }
  });
  triggerWatch.observe(trigger);
}

function unportalMenu(): void {
  stopWatchingTrigger();
  if (!portalReturn) return;
  const { menu, parent, next } = portalReturn;
  // Back inside its root, the descendant selector takes over again.
  menu.classList.remove("open");
  parent.insertBefore(menu, next);
  portalReturn = null;
  openSelect = null;
}

function portalMenu(root: HTMLElement, menu: HTMLElement): void {
  unportalMenu(); // single-open rule: return the previous menu first
  const parent = menu.parentNode;
  if (!parent) return;
  portalReturn = { menu, parent, next: menu.nextSibling };
  // On <body> the .tt-select.open descendant selector no longer matches —
  // the menu carries its own .open while portaled or it stays display:none.
  menu.classList.add("open");
  document.body.appendChild(menu);
  openSelect = { root, menu };
  const trigger = root.querySelector<HTMLElement>(".tt-select-trigger");
  if (trigger) watchTrigger(trigger);
}

// Click/press outside the open control dismisses it (nav, Apply, etc.).
// Capture phase so we win before stopPropagation on triggers.
document.addEventListener(
  "pointerdown",
  (e) => {
    if (!openSelect) return;
    const t = e.target;
    if (!(t instanceof Node)) return;
    if (openSelect.menu.contains(t) || openSelect.root.contains(t)) return;
    closeAllSelects();
  },
  true,
);

/** Options of the root's menu, wherever the menu currently lives. */
function menuOptions(root: HTMLElement): HTMLElement[] {
  const menu =
    openSelect?.root === root
      ? openSelect.menu
      : root.querySelector<HTMLElement>(".tt-select-menu");
  return menu ? [...menu.querySelectorAll<HTMLElement>(".tt-option")] : [];
}

function placeSelectMenu(trigger: HTMLElement, menu: HTMLElement): void {
  const rect = trigger.getBoundingClientRect();
  const spaceBelow = window.innerHeight - rect.bottom;
  const dropUp = spaceBelow < 180;
  menu.dataset.drop = dropUp ? "up" : "down";
  menu.style.width = `${rect.width}px`;
  menu.style.left = `${rect.left}px`;
  menu.style.right = "auto";
  if (dropUp) {
    menu.style.top = "auto";
    menu.style.bottom = `${window.innerHeight - rect.top + 4}px`;
  } else {
    menu.style.bottom = "auto";
    menu.style.top = `${rect.bottom + 4}px`;
  }
}

function pickOption(root: HTMLElement, opt: HTMLElement): void {
  for (const o of menuOptions(root)) {
    o.setAttribute("aria-selected", o === opt ? "true" : "false");
  }
  const valueEl = root.querySelector(".tt-select-value");
  if (valueEl) valueEl.textContent = opt.textContent;
  // Settings panels collect from this attribute (the shell's input/change
  // delegation misses custom controls).
  root.dataset.current = opt.dataset.value ?? "";
  // Must unportal: the open menu lives on <body> with its own .open class;
  // clearing only root.open leaves the list floating in place.
  closeAllSelects();
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
  const menu = root.querySelector<HTMLElement>(".tt-select-menu");
  const trigger = root.querySelector<HTMLElement>(".tt-select-trigger");
  if (menu && trigger) {
    portalMenu(root, menu);
    placeSelectMenu(trigger, menu);
  }
}

function onSelectKeydown(root: HTMLElement, e: KeyboardEvent): void {
  const options = menuOptions(root);
  if (options.length === 0) return;
  const open = root.classList.contains("open");
  const activeIdx = options.findIndex((o) => o.classList.contains("active"));
  if (e.key === "Escape" && open) {
    e.preventDefault();
    e.stopPropagation(); // don't close the surrounding panel/dialog
    closeAllSelects();
    root.querySelector<HTMLElement>(".tt-select-trigger")?.focus();
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
    /** Extra classes on the root `.tt-select` (e.g. `tt-select--wide`). */
    className?: string;
  },
): TemplateResult {
  const disabled = opts?.disabled ?? false;
  const option = ([value, text]: readonly [string, string]): TemplateResult => html`
    <button
      type="button"
      class="tt-option"
      role="option"
      data-value=${value}
      title=${ifDefined(opts?.descs?.[value])}
      aria-selected=${value === current ? "true" : "false"}
      @click=${(e: Event) => {
        e.stopPropagation();
        // The menu may be portaled to <body>: prefer the open-select
        // back-reference over DOM ancestry.
        const opt = e.currentTarget as HTMLElement;
        const menu = opt.closest(".tt-select-menu");
        const root =
          (menu && openSelect?.menu === menu ? openSelect.root : null) ??
          opt.closest<HTMLElement>(".tt-select");
        if (root) pickOption(root, opt);
      }}
    >${text}</button>
  `;
  const menuBody = opts?.groups
    ? opts.groups.map(
        (g) => html`
          <div class="tt-optgroup">${g.label}</div>
          ${g.items.map(option)}
        `,
      )
    : options.map(option);
  const currentText =
    options.find(([v]) => v === current)?.[1] ??
    opts?.groups?.flatMap((g) => g.items).find(([v]) => v === current)?.[1] ??
    current;
  const rootClass = `tt-select${disabled ? " tt-disabled" : ""}${
    opts?.className ? ` ${opts.className}` : ""
  }`;
  return html`
    <div
      class=${rootClass}
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
        class="tt-select-trigger"
        aria-haspopup="listbox"
        ?disabled=${disabled}
        @click=${(e: Event) => {
          e.stopPropagation();
          const root = (e.currentTarget as HTMLElement).parentElement;
          if (!disabled && root) onSelectTriggerClick(root);
        }}
      ><span class="tt-select-value" data-current-text=${currentText}></span></button>
      <div class="tt-select-menu" role="listbox">
        ${menuBody}
      </div>
    </div>
  `;
}

/** Sync trigger texts after every render (see module header). */
export function syncSelectTexts(root: ParentNode): void {
  for (const span of root.querySelectorAll<HTMLElement>(".tt-select-value[data-current-text]")) {
    const text = span.dataset.currentText ?? "";
    if (span.textContent !== text) span.textContent = text;
  }
}
