// Minimal toast notifications (bottom-right, auto-dismiss).

export type ToastKind = "error" | "info";

let container: HTMLElement | null = null;

function ensureContainer(): HTMLElement {
  if (!container || !container.isConnected) {
    container = document.createElement("div");
    container.id = "toast-container";
    document.body.appendChild(container);
  }
  return container;
}

export function showToast(message: string, kind: ToastKind = "info", duration = 4000): HTMLElement {
  const el = document.createElement("div");
  el.className = `toast toast-${kind}`;
  el.textContent = message;
  ensureContainer().appendChild(el);
  // enter animation
  requestAnimationFrame(() => el.classList.add("visible"));
  const timer = setTimeout(() => dismiss(), duration);

  function dismiss() {
    clearTimeout(timer);
    el.classList.remove("visible");
    setTimeout(() => el.remove(), 200);
  }
  el.addEventListener("click", dismiss);
  return el;
}
