// OSC 9;4 progress reporting (Windows Terminal / ConEmu protocol).
// Sequence: ESC ] 9 ; 4 ; <state> ; <progress> ST
//   state: 0 = hidden, 1 = normal (progress 0-100), 2 = error,
//          3 = indeterminate, 4 = warning
// xterm.js delivers this as OSC ident 9 with data "4;<state>;<progress>".

export interface Osc94Progress {
  state: number;
  progress: number;
}

export const OSC94_STATE_NAMES = ["hidden", "normal", "error", "indeterminate", "warning"] as const;

// Parse xterm OSC-9 payload data. Returns null for non-progress (non "4;") subtypes
// or malformed sequences, letting other OSC 9 uses pass through.
export function parseOsc9Progress(data: string): Osc94Progress | null {
  const parts = data.split(";");
  if (parts[0] !== "4" || parts.length < 2) return null;

  const state = Number(parts[1]);
  if (!Number.isInteger(state) || state < 0 || state > 4) return null;

  let progress = 0;
  if (parts.length >= 3 && parts[2] !== "") {
    const p = Number(parts[2]);
    if (!Number.isFinite(p)) return null;
    progress = Math.max(0, Math.min(100, Math.round(p)));
  }
  return { state, progress };
}

// Render progress state onto a tab element. The bar element is created lazily
// and hidden again when state is 0 (hidden).
export function applyProgressToTabElement(tabEl: HTMLElement, state: number, progress: number): void {
  let bar = tabEl.querySelector(".tab-progress") as HTMLElement | null;
  if (state === 0) {
    bar?.remove();
    return;
  }
  if (!bar) {
    bar = document.createElement("div");
    bar.className = "tab-progress";
    tabEl.appendChild(bar);
  }
  bar.className = `tab-progress state-${OSC94_STATE_NAMES[state] ?? "normal"}`;
  if (state === 3) {
    // indeterminate: CSS animation drives the bar
    bar.style.width = "";
  } else {
    bar.style.width = `${progress}%`;
  }
}
