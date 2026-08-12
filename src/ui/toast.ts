// Minimal toast notifications (bottom-right, auto-dismiss).

export type ToastKind = "error" | "info";

// Returned by showToast: dismiss() removes the toast before its duration
// elapses (long-running operations like SSH connect clear their "pending"
// toast on settle).
export interface ToastHandle extends HTMLElement {
  dismiss(): void;
}

let container: HTMLElement | null = null;

function ensureContainer(): HTMLElement {
  if (!container?.isConnected) {
    container = document.createElement("div");
    container.id = "toast-container";
    document.body.appendChild(container);
  }
  return container;
}

export function showToast(message: string, kind: ToastKind = "info", duration = 4000): ToastHandle {
  const el = document.createElement("div") as unknown as ToastHandle;
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
  el.dismiss = dismiss;
  el.addEventListener("click", dismiss);
  return el;
}
