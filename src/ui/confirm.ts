// Generic in-app confirm dialog — the single way to ask yes/no, replacing
// native OS dialogs (which clash with the app's own modal look). Built on
// createModal with the shared sshauth dialog styles. Every dismissal path
// (Cancel, Escape, backdrop) resolves false: a dismissal never confirms.

import { createModal } from "./modal";

export interface ConfirmOptions {
  title: string;
  message: string;
  okLabel?: string;
  cancelLabel?: string;
  // Red header + danger button for destructive actions.
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
    <div class="sshauth-dialog${options.danger ? " sshauth-dialog-danger" : ""}">
      <div class="sshauth-header${options.danger ? " sshauth-header-danger" : ""}"></div>
      <div class="sshauth-body"><div class="sshauth-text confirm-text"></div></div>
      <div class="sshauth-footer">
        <button class="sshauth-btn sshauth-btn-cancel" type="button"></button>
        <button class="sshauth-btn ${options.danger ? "sshauth-btn-danger" : "sshauth-btn-ok"}" type="button"></button>
      </div>
    </div>`;
  overlay.querySelector(".sshauth-header")!.textContent = options.title;
  overlay.querySelector(".confirm-text")!.textContent = options.message;
  const cancelBtn = overlay.querySelector<HTMLButtonElement>(".sshauth-btn-cancel")!;
  cancelBtn.textContent = options.cancelLabel ?? "Cancel";
  const okBtn = overlay.querySelector<HTMLButtonElement>(
    ".sshauth-footer .sshauth-btn:last-child",
  )!;
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
