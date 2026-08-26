// Generic in-app confirm dialog — the single way to ask yes/no, replacing
// native OS dialogs (which clash with the app's own modal look). Built on
// createModal + kit shell (docs/confirm-preview.html): 420px well dialog,
// header / body / footer, OK or danger primary, warn border for destructive
// actions. Every dismissal path (Cancel, Escape, backdrop) resolves false:
// a dismissal never confirms.

import { createConfirmMessageDialog, createConfirmPasteDialog } from "./kit/shell";
import { createModal } from "./modal";

export interface ConfirmOptions {
  title: string;
  message: string;
  // Secondary explainer line under the message (design .cf-meta).
  meta?: string;
  // Mono preview block (design .cf-preview) — e.g. the paste's first lines.
  preview?: string;
  okLabel?: string;
  cancelLabel?: string;
  // Warn border + danger button for destructive actions.
  danger?: boolean;
}

/** Multi-line paste confirmation (docs/confirm-preview.html): title with
 *  an "N lines" header meta, and the clipboard body as an EDITABLE mono
 *  textarea — the user reviews/edits before it runs. Resolves the edited
 *  text, or null on any dismissal (Cancel / Escape / backdrop). */
export function confirmPaste(options: { lines: number; text: string }): Promise<string | null> {
  const { promise, resolve } = Promise.withResolvers<string | null>();
  let answered = false;
  const answer = (v: string | null) => {
    if (answered) return;
    answered = true;
    resolve(v);
  };
  const modal = createModal({
    className: "cf-overlay",
    onClose: () => answer(null),
  });
  const shell = createConfirmPasteDialog({
    lines: options.lines,
    text: options.text,
  });
  modal.overlay.appendChild(shell.dialog);
  document.body.appendChild(modal.overlay);

  shell.cancelBtn.addEventListener("click", () => modal.close());
  shell.okBtn.addEventListener("click", () => {
    answer(shell.textarea.value);
    modal.close();
  });
  shell.textarea.focus();
  // Caret at the end — review starts from the last command.
  shell.textarea.setSelectionRange(shell.textarea.value.length, shell.textarea.value.length);

  return promise;
}

export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  const { promise, resolve } = Promise.withResolvers<boolean>();
  let answered = false;
  const answer = (v: boolean) => {
    if (answered) return;
    answered = true;
    resolve(v);
  };
  const modal = createModal({
    className: "cf-overlay",
    onClose: () => answer(false),
  });
  const shell = createConfirmMessageDialog({
    title: options.title,
    message: options.message,
    meta: options.meta,
    preview: options.preview,
    okLabel: options.okLabel,
    cancelLabel: options.cancelLabel,
    danger: options.danger,
  });
  modal.overlay.appendChild(shell.dialog);
  document.body.appendChild(modal.overlay);

  shell.cancelBtn.addEventListener("click", () => modal.close());
  shell.okBtn.addEventListener("click", () => {
    answer(true);
    modal.close();
  });
  shell.okBtn.focus();

  return promise;
}
