// Fixed chrome builders shared by the app and drafts/*-preview.html.
// Structure + class names only — callers wire events and fill dynamic rows.
// CSS: palette.css / confirm.css. Do not duplicate this markup in drafts.

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// ---- Palette / quick-open / MRU ----

export type PaletteShellKind = "commands" | "quick" | "mru";

export interface PaletteShell {
  overlay: HTMLElement;
  panel: HTMLElement;
  wrap: HTMLElement;
  /** Present for kind "commands" (toggle `.on` for command vs tab face). */
  prefix: HTMLSpanElement | null;
  /** Present for kind "commands" | "quick". */
  input: HTMLInputElement | null;
  list: HTMLElement;
  /** Cursor-style key footer; hidden until `setPaletteFooter` fills it. */
  footer: HTMLElement;
}

/** One footer chip: glyph (`↑↓` / `↵` / `⇥` / `Del`) + action word. */
export interface PaletteFooterHint {
  key: string;
  label: string;
}

export const PAL_FOOT = {
  select: { key: "↑↓", label: "Select" },
  open: { key: "↵", label: "Open" },
  connect: { key: "↵", label: "Connect" },
  add: { key: "↵", label: "Add" },
  complete: { key: "⇥", label: "Complete" },
  remove: { key: "Del", label: "Remove" },
} as const;

/** Fill or hide the palette footer. Empty / null hides it (command root, Ctrl+P). */
export function setPaletteFooter(footer: HTMLElement, hints: PaletteFooterHint[] | null): void {
  footer.replaceChildren();
  if (!hints?.length) {
    footer.classList.remove("on");
    footer.hidden = true;
    return;
  }
  footer.hidden = false;
  footer.classList.add("on");
  for (const h of hints) {
    const item = el("span", "pal-foot-item");
    item.append(el("span", "pal-foot-key", h.key), el("span", "pal-foot-label", h.label));
    footer.appendChild(item);
  }
}

export interface PaletteShellOptions {
  kind: PaletteShellKind;
  ids?: Partial<{ overlay: string; input: string; prefix: string; list: string }>;
  label?: string;
  placeholder?: string;
}

export function createPaletteShell(opts: PaletteShellOptions): PaletteShell {
  const overlay = el("div", "pal-overlay");
  if (opts.ids?.overlay) overlay.id = opts.ids.overlay;

  const panel = el("div", "pal-panel");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute(
    "aria-label",
    opts.label ??
      (opts.kind === "mru" ? "Recent tabs" : opts.kind === "quick" ? "Go to tab" : "Palette"),
  );

  const wrap = el("div", "pal-input-wrap");
  let prefix: HTMLSpanElement | null = null;
  let input: HTMLInputElement | null = null;

  if (opts.kind === "commands") {
    prefix = el("span", "pal-prefix on", ">");
    if (opts.ids?.prefix) prefix.id = opts.ids.prefix;
    input = document.createElement("input");
    input.className = "pal-input";
    input.type = "text";
    input.spellcheck = false;
    input.autocomplete = "off";
    if (opts.placeholder) input.placeholder = opts.placeholder;
    if (opts.ids?.input) input.id = opts.ids.input;
    wrap.append(prefix, input);
  } else if (opts.kind === "quick") {
    input = document.createElement("input");
    input.className = "pal-input";
    input.type = "text";
    input.spellcheck = false;
    input.autocomplete = "off";
    input.placeholder = opts.placeholder ?? "Go to tab — number or name; > for commands";
    if (opts.ids?.input) input.id = opts.ids.input;
    wrap.append(input);
  } else {
    wrap.append(el("span", "pal-mru-hint", "Release Ctrl to switch"));
  }

  const list = el("div", "pal-list");
  if (opts.ids?.list) list.id = opts.ids.list;

  const footer = el("div", "pal-footer");
  footer.hidden = true;

  panel.append(wrap, list, footer);
  overlay.append(panel);
  return { overlay, panel, wrap, prefix, input, list, footer };
}

// ---- Confirm dialogs ----

export interface ConfirmShell {
  dialog: HTMLElement;
  header: HTMLElement;
  body: HTMLElement;
  footer: HTMLElement;
  cancelBtn: HTMLButtonElement;
  okBtn: HTMLButtonElement;
}

export function createConfirmOverlay(opts?: { id?: string }): HTMLElement {
  const overlay = el("div", "cf-overlay");
  if (opts?.id) overlay.id = opts.id;
  overlay.setAttribute("aria-hidden", "true");
  return overlay;
}

export interface ConfirmPasteShell extends ConfirmShell {
  textarea: HTMLTextAreaElement;
  linesStrong: HTMLElement;
}

export interface ConfirmPasteOptions {
  lines?: number;
  text?: string;
  ids?: Partial<{ title: string; lines: string; preview: string; ok: string }>;
  cancelCloseAttr?: string;
  okCloseAttr?: string;
}

/** Paste-multiple-lines dialog (header meta + flush editable preview). */
export function createConfirmPasteDialog(opts: ConfirmPasteOptions = {}): ConfirmPasteShell {
  const dialog = el("div", "cf-dialog");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  const titleId = opts.ids?.title ?? "paste-title";
  dialog.setAttribute("aria-labelledby", titleId);

  const header = el("div", "cf-header");
  const title = el("span", undefined, "Paste multiple lines?");
  title.id = titleId;
  const headerMeta = el("span", "cf-header-meta");
  const linesStrong = el("strong", undefined, String(opts.lines ?? 0));
  if (opts.ids?.lines) linesStrong.id = opts.ids.lines;
  headerMeta.append(linesStrong, document.createTextNode(" lines"));
  header.append(title, headerMeta);

  const body = el("div", "cf-body cf-body-flush");
  const textarea = document.createElement("textarea");
  textarea.className = "cf-preview tt-scroll";
  textarea.spellcheck = false;
  textarea.autocomplete = "off";
  textarea.setAttribute("aria-label", "Paste preview");
  if (opts.ids?.preview) textarea.id = opts.ids.preview;
  if (opts.text !== undefined) textarea.value = opts.text;
  body.append(textarea);

  const footer = el("div", "cf-footer");
  const cancelBtn = el("button", "tt-btn tt-btn-ghost cf-cancel", "Cancel");
  cancelBtn.type = "button";
  if (opts.cancelCloseAttr) cancelBtn.dataset.close = opts.cancelCloseAttr;
  const okBtn = el("button", "tt-btn tt-btn-primary", "Paste");
  okBtn.type = "button";
  if (opts.ids?.ok) okBtn.id = opts.ids.ok;
  if (opts.okCloseAttr) okBtn.dataset.close = opts.okCloseAttr;
  footer.append(cancelBtn, okBtn);

  dialog.append(header, body, footer);
  return { dialog, header, body, footer, cancelBtn, okBtn, textarea, linesStrong };
}

export interface ConfirmMessageOptions {
  title: string;
  message: string;
  meta?: string;
  preview?: string;
  okLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  ids?: Partial<{ title: string; ok: string }>;
  cancelCloseAttr?: string;
  okCloseAttr?: string;
}

export interface ConfirmMessageShell extends ConfirmShell {
  text: HTMLElement;
  preview: HTMLElement | null;
  meta: HTMLElement | null;
}

/** Generic yes/no confirm (optional mono preview + meta). */
export function createConfirmMessageDialog(opts: ConfirmMessageOptions): ConfirmMessageShell {
  const dialog = el("div", `cf-dialog${opts.danger ? " warn" : ""}`);
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  if (opts.ids?.title) dialog.setAttribute("aria-labelledby", opts.ids.title);

  const header = el("div", "cf-header", opts.title);
  if (opts.ids?.title) header.id = opts.ids.title;

  const body = el("div", "cf-body");
  const text = el("div", "cf-text confirm-text", opts.message);
  body.append(text);

  let preview: HTMLElement | null = null;
  if (opts.preview !== undefined) {
    preview = el("pre", "cf-preview tt-scroll", opts.preview);
    body.append(preview);
  }
  let meta: HTMLElement | null = null;
  if (opts.meta !== undefined) {
    meta = el("div", "cf-meta", opts.meta);
    body.append(meta);
  }

  const footer = el("div", "cf-footer");
  const cancelBtn = el("button", "tt-btn tt-btn-ghost cf-cancel", opts.cancelLabel ?? "Cancel");
  cancelBtn.type = "button";
  if (opts.cancelCloseAttr) cancelBtn.dataset.close = opts.cancelCloseAttr;
  const okBtn = el(
    "button",
    `tt-btn ${opts.danger ? "tt-btn-danger-fill" : "tt-btn-primary"}`,
    opts.okLabel ?? "OK",
  );
  okBtn.type = "button";
  if (opts.ids?.ok) okBtn.id = opts.ids.ok;
  if (opts.okCloseAttr) okBtn.dataset.close = opts.okCloseAttr;
  footer.append(cancelBtn, okBtn);

  dialog.append(header, body, footer);
  return { dialog, header, body, footer, cancelBtn, okBtn, text, preview, meta };
}
