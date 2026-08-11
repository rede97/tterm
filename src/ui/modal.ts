// Shared modal scaffolding: overlay element + Escape (capture phase) and
// backdrop-click dismissal + idempotent close. Dialogs supply their own
// content and className; onClose runs exactly once, before removal — use it
// for cleanup and for "dismiss = cancel" responses.
//
// singleton (default true): opening a modal with a className that is already
// open closes the previous instance first (no orphaned overlays/listeners).
// sshauth opts out: several auth prompts can be pending at once.

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
      if (openModals.get(className) === handle) openModals.delete(className);
      const i = modalStack.indexOf(handle);
      if (i !== -1) modalStack.splice(i, 1);
      onClose?.();
      document.removeEventListener("keydown", onKeydown, true);
      overlay.remove();
    },
  };

  if (options.singleton !== false) openModals.set(className, handle);
  modalStack.push(handle);
  document.addEventListener("keydown", onKeydown, true);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) handle.close();
  });
  return handle;
}
