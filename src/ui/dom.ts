// Shared DOM helpers — the ONE copy. (Five private duplicates of el() had
// accumulated across quickpanel / forwardeditor / forwardtable /
// tabswitcher / settings-shortcuts; new UI modules import from here.)

/** Create an element with a class and optional text content. */
export function el(tag: string, className: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

// -- Auto-escaping HTML tagged template --
//
// innerHTML with hand-interpolated values is an XSS hatch: every ${} needs
// a manual esc(), and ONE forgotten call is an injection. The html`` tag
// escapes every interpolation by default; structure stays readable:
//
//   setHtml(panel, html`<div class="row">${host.name} — ${host.user}</div>`);
//
// Nested html`` results compose (not double-escaped), arrays flatten,
// null/undefined render as "". The ONLY way to inject raw markup is the
// explicit raw() escape hatch — name the reason at the call site.

export class SafeHtml {
  constructor(private readonly s: string) {}
  toString(): string {
    return this.s;
  }
}

/** Mark a string as already-safe markup. The call site owns the proof. */
export function raw(s: string): SafeHtml {
  return new SafeHtml(s);
}

function escapeHtml(s: string): string {
  return (
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      // Defense in depth: no single-quoted attribute interpolation exists
      // today, but escaping `'` keeps that class of injection impossible.
      .replace(/'/g, "&#39;")
  );
}

function render(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof SafeHtml) return value.toString();
  if (Array.isArray(value)) return value.map(render).join("");
  if (typeof value === "string") return escapeHtml(value);
  return escapeHtml(String(value));
}

export function html(strings: TemplateStringsArray, ...values: unknown[]): SafeHtml {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) {
    out += render(values[i]) + strings[i + 1];
  }
  return new SafeHtml(out);
}

/** innerHTML assignment that only accepts escaped template output. */
export function setHtml(target: HTMLElement, content: SafeHtml): void {
  target.innerHTML = content.toString();
}

// -- Required-element lookups (replace the old `!` assertion) --
//
// App-chrome ids and just-rendered template nodes are guaranteed to exist;
// a missing one is a bug. These throw a descriptive error instead of the
// opaque `TypeError: ... is null` the `!` assertion produced, without
// changing the failure mode.

/** Get an app-chrome element by id, throwing a descriptive error if absent. */
export function mustGetById(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing app-chrome element: #${id}`);
  return el;
}

/** Query a required descendant, throwing a descriptive error if absent. */
export function mustQuery<T extends Element = HTMLElement>(
  parent: ParentNode,
  selector: string,
): T {
  const el = parent.querySelector<T>(selector);
  if (!el) throw new Error(`missing required element: ${selector}`);
  return el;
}
