// Shared modal scaffolding: overlay element + Escape (capture phase) and
// backdrop-click dismissal + idempotent close. Dialogs supply their own
// content and className; onClose runs exactly once, before removal — use it
// for cleanup and for "dismiss = cancel" responses.
//
// singleton (default true): opening a modal with a className that is already
// open closes the previous instance first (no orphaned overlays/listeners).
// sshauth opts out: several auth prompts can be pending at once.
//
// close() always dismisses any portaled ttSelect menu first — selects live
// on <body> while open, so removing the overlay alone would orphan them.

import { closeAllSelects } from "./select";
import { restoreTerminalFocus } from "./termfocus";

export interface ModalHandle {
  overlay: HTMLElement;
  close(): void;
}

export interface ModalOptions {
  className: string;
  onClose?: () => void;
  singleton?: boolean;
}

const openModals = new Map<string, ModalHandle>();
// Open order. Escape must close only the TOP modal: every modal installs
// a capture-phase keydown listener, so without this check one Escape
// closes every open modal at once (e.g. stacked ssh auth prompts, each
// answering "cancelled" to the backend).
const modalStack: ModalHandle[] = [];

export function createModal(options: ModalOptions): ModalHandle {
  const { className, onClose } = options;
  if (options.singleton !== false) openModals.get(className)?.close();

  const overlay = document.createElement("div");
  overlay.className = className;
  let closed = false;

  const onKeydown = (e: KeyboardEvent) => {
    if (e.key === "Escape" && modalStack[modalStack.length - 1] === handle) handle.close();
  };

  const handle: ModalHandle = {
    overlay,
    close() {
      if (closed) return;
      closed = true;
      // Portaled select menus sit on <body>; tear them down before the
      // overlay (and its triggers) disappear.
      closeAllSelects();
      if (openModals.get(className) === handle) openModals.delete(className);
      const i = modalStack.indexOf(handle);
      if (i !== -1) modalStack.splice(i, 1);
      onClose?.();
      document.removeEventListener("keydown", onKeydown, true);
      overlay.remove();
      // Last modal gone: typing belongs on the active terminal again
      // (paste confirm, close-window cancel, host-key, …). Nested
      // Settings editors leave another modal on the stack and skip this.
      if (modalStack.length === 0) restoreTerminalFocus();
    },
  };

  if (options.singleton !== false) openModals.set(className, handle);
  modalStack.push(handle);
  document.addEventListener("keydown", onKeydown, true);
  // Close on dimmer click only when the press started on the overlay
  // itself. A drag that begins inside the dialog and is released on the
  // dimmer (Sortable / font fallback chain) must not dismiss.
  let pressOnBackdrop = false;
  overlay.addEventListener("pointerdown", (e) => {
    pressOnBackdrop = e.target === overlay;
  });
  overlay.addEventListener("mousedown", (e) => {
    pressOnBackdrop = e.target === overlay;
  });
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay && pressOnBackdrop) handle.close();
  });
  return handle;
}

export function hasOpenModal(): boolean {
  return modalStack.length > 0;
}

/** Tests: drop leftover overlays/listeners so files don't leak stack state. */
export function resetModalsForTests(): void {
  for (const h of [...modalStack]) h.close();
}
