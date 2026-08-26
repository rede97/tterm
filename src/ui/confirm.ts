// Generic in-app confirm dialog — the single way to ask yes/no, replacing
// native OS dialogs (which clash with the app's own modal look). Built on
// createModal with the cf-* shared chrome (docs/confirm-preview.html):
// 420px well dialog, header / body (text + optional meta + optional mono
// preview) / footer, OK or danger primary, warn border for destructive
// actions. Every dismissal path (Cancel, Escape, backdrop) resolves
// false: a dismissal never confirms.

import { mustQuery } from "./dom";
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

export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  const { promise, resolve } = Promise.withResolvers<boolean>();
  let answered = false;
  const answer = (v: boolean) => {
    if (answered) return;
    answered = true;
    resolve(v);
  };
  const modal = createModal({
    className: "sshauth-overlay confirm-overlay",
    onClose: () => answer(false),
  });
  const overlay = modal.overlay;

  overlay.innerHTML = `
    <div class="cf-dialog${options.danger ? " warn" : ""}" role="dialog" aria-modal="true">
      <div class="cf-header"></div>
      <div class="cf-body">
        <div class="cf-text confirm-text"></div>
        ${options.preview !== undefined ? `<pre class="cf-preview tt-scroll"></pre>` : ""}
        ${options.meta !== undefined ? `<div class="cf-meta"></div>` : ""}
      </div>
      <div class="cf-footer">
        <button class="cf-btn cf-cancel" type="button"></button>
        <button class="cf-btn ${options.danger ? "cf-btn-danger" : "cf-btn-ok"}" type="button"></button>
      </div>
    </div>`;
  mustQuery(overlay, ".cf-header").textContent = options.title;
  mustQuery(overlay, ".confirm-text").textContent = options.message;
  if (options.preview !== undefined) {
    mustQuery(overlay, ".cf-preview").textContent = options.preview;
  }
  if (options.meta !== undefined) {
    mustQuery(overlay, ".cf-meta").textContent = options.meta;
  }
  const cancelBtn = mustQuery<HTMLButtonElement>(overlay, ".cf-cancel");
  cancelBtn.textContent = options.cancelLabel ?? "Cancel";
  const okBtn = mustQuery<HTMLButtonElement>(overlay, ".cf-footer .cf-btn:last-child");
  okBtn.textContent = options.okLabel ?? "OK";
  document.body.appendChild(overlay);

  cancelBtn.addEventListener("click", () => modal.close()); // onClose answers false
  okBtn.addEventListener("click", () => {
    answer(true);
    modal.close();
  });
  okBtn.focus();

  return promise;
}
