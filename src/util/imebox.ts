// Floating IME composition mirror — see docs/ime-composition.md.
// Shows the in-progress IME composition near the (possibly fake) cursor,
// anchored ONCE at compositionstart and frozen until compositionend — so the
// box never drifts while the terminal content scrolls or the cursor moves
// underneath. After commit the mirror lingers briefly, then fades out.
//
// Hard boundary: this component is PURE DISPLAY. It never takes focus and
// never injects text into the terminal — the committed string travels
// xterm's own textarea → onData → PTY path, untouched.

import { swallow } from "../core/errorlog";

export interface CursorPos {
  x: number; // px, relative to the terminal element
  y: number;
  cellH: number;
}

// ---- Enable mode --------------------------------------------------------
// "auto"   — mirror only when the TUI hides the hardware cursor (pi/claude)
// "always" — mirror everywhere, incl. normal shells (testing override)
// "off"    — never mirror
// Default is "always" FOR THE TESTING PHASE so the mirror can be evaluated
// without launching a cursor-hiding TUI; revisit to "auto" at M3 (settings
// toggle) once real-IME experience confirms the behavior. Persisted in
// localStorage so a tester flips it once and it sticks across restarts.
export type ImeMirrorMode = "auto" | "always" | "off";

const MODE_STORAGE_KEY = "tterm.imeMirrorMode";
const DEFAULT_MODE: ImeMirrorMode = "always";

function loadMode(): ImeMirrorMode {
  try {
    const v = localStorage.getItem(MODE_STORAGE_KEY);
    if (v === "auto" || v === "always" || v === "off") return v;
  } catch {
    swallow(); // localStorage unavailable (tests)
  }
  return DEFAULT_MODE;
}

let mode: ImeMirrorMode = loadMode();
const modeListeners = new Set<(m: ImeMirrorMode) => void>();

export function getImeMirrorMode(): ImeMirrorMode {
  return mode;
}

export function setImeMirrorMode(m: ImeMirrorMode): void {
  mode = m;
  try {
    localStorage.setItem(MODE_STORAGE_KEY, m);
  } catch {
    swallow(); // localStorage unavailable (tests)
  }
  for (const fn of modeListeners) fn(m);
}

export function onImeMirrorModeChange(fn: (m: ImeMirrorMode) => void): void {
  modeListeners.add(fn);
}

// Should the mirror intercept compositions for a tab whose hardware cursor
// hidden-state is `cursorHidden`?
export function imeMirrorActiveFor(cursorHidden: boolean): boolean {
  return mode === "always" || (mode === "auto" && cursorHidden);
}

// ---- Debug flags & tracer (M2 diagnostics) --------------------------------
// Bisection switches for real-IME issues: flip from the dev console via
// __tterm.imeDebug({ suppress: false }) etc., then retry the composition.
export interface ImeDebugFlags {
  suppress: boolean; // CSS suppression of xterm's composition-view
  reanchor: boolean; // 200ms re-anchor interval in the freeze proxy
}
const debugFlags: ImeDebugFlags = { suppress: true, reanchor: true };
export function getImeDebugFlags(): ImeDebugFlags {
  return { ...debugFlags };
}
export function setImeDebugFlags(f: Partial<ImeDebugFlags>): void {
  Object.assign(debugFlags, f);
}

// Composition lifecycle tracer: logs start/update/end + textarea focus/blur
// with timestamps, so a real-IME repro shows exactly who ends the composition
// (IME cancel vs blur vs xterm finalize).
let traceOn = false;
export function setImeTrace(on: boolean): void {
  traceOn = on;
}
function trace(msg: string): void {
  if (traceOn) console.log(`[ime ${performance.now().toFixed(0)}ms] ${msg}`);
}

// ---- Mirror component ----------------------------------------------------

const LINGER_MS = 0; // stay visible after commit (bridges the echo gap)
const FADE_MS = 0; // opacity transition, must match .ime-box CSS

export class ImeBox {
  private el: HTMLElement;
  private active = false;
  private anchor: CursorPos | null = null;
  private lingerTimer: number | null = null;
  private fadeTimer: number | null = null;
  private placeRaf: number | null = null;
  private blurHideTimer: number | null = null;
  private windowBlurHandler: (() => void) | null = null;

  constructor(
    private parent: HTMLElement,
    fontFamily = "",
  ) {
    this.el = document.createElement("div");
    this.el.className = "ime-box";
    if (fontFamily) this.el.style.fontFamily = fontFamily;
    this.el.style.display = "none";
    parent.appendChild(this.el);
  }

  // getPos is called exactly once per composition (anti-drift core).
  // shouldMirror gates activation (cursor-hidden / force mode); when it
  // returns false the whole composition is ignored and xterm's native
  // inline composition-view stays in charge.
  attach(
    textarea: HTMLElement,
    getPos: () => CursorPos,
    shouldMirror: () => boolean = () => true,
  ): void {
    // OS-level window defocus (Alt+Tab, another TTerm window): with a live
    // TSF composition WebView2 may never deliver the textarea's blur, which
    // would strand the mirror in a background window. Window blur never
    // fires for IME candidate clicks (non-activating top-level), so hide
    // immediately — no defer tick. Removed in destroy(): a window listener
    // would otherwise leak the whole tab past its lifetime.
    this.windowBlurHandler = () => {
      if (!this.active) return;
      trace("window blur — hiding mirror");
      this._cancelTimers();
      this._hide();
    };
    window.addEventListener("blur", this.windowBlurHandler);
    textarea.addEventListener("focus", () => {
      trace("textarea focus");
      // Focus returned before a deferred blur-hide ran (e.g. IME candidate
      // click briefly stole focus) — keep the in-flight mirror.
      this._cancelBlurHide();
    });
    // Focus left mid-composition: WebView2/TSF often cancels without a
    // reliable compositionend, leaving the mirror stuck until the next
    // compositionstart. Defer a tick so a same-turn compositionend / focus
    // return (candidate-window click) can cancel the hide.
    textarea.addEventListener("blur", () => {
      trace("textarea BLUR");
      if (!this.active) return;
      this._cancelBlurHide();
      this.blurHideTimer = window.setTimeout(() => {
        this.blurHideTimer = null;
        if (!this.active) return;
        trace("blur-hide (composition cancelled without end)");
        this._cancelTimers();
        this._hide();
      }, 0);
    });
    textarea.addEventListener("compositionstart", () => {
      trace("compositionstart");
      this._cancelBlurHide();
      if (!shouldMirror()) return;
      this._cancelTimers();
      this.anchor = getPos();
      this.el.textContent = "";
      this.el.classList.remove("fading");
      this.active = true;
      this._place();
      this.el.style.display = "block";
    });
    textarea.addEventListener("compositionupdate", (e: CompositionEvent) => {
      trace(`compositionupdate "${e.data ?? ""}"`);
      this._cancelBlurHide();
      if (!this.active) return;
      this.el.textContent = e.data ?? "";
      // Empty composition (all pinyin deleted / IME cleared the string):
      // an empty shell of a box looks broken — hide it, stay active.
      this.el.style.display = this.el.textContent ? "block" : "none";
      // Defer the re-clamp layout read out of the event dispatch — forced
      // synchronous layout mid-composition is a composition-stability risk
      // with real TSF IMEs.
      if (this.placeRaf === null) {
        const raf =
          window.requestAnimationFrame ?? ((f: FrameRequestCallback) => window.setTimeout(f, 0));
        this.placeRaf = raf(() => {
          this.placeRaf = null;
          if (this.active) this._place();
        });
      }
    });
    textarea.addEventListener("compositionend", (e: CompositionEvent) => {
      trace(`compositionend "${(e as CompositionEvent).data ?? ""}"`);
      this._cancelBlurHide();
      if (!this.active) return;
      this.active = false;
      const committed = (e as CompositionEvent).data ?? "";
      // Cancelled (Esc / focus loss with empty commit): drop the preedit
      // immediately — linger is only for bridging the echo gap after a
      // successful commit.
      if (!committed) {
        this._hide();
        return;
      }
      // linger → fade → remove
      this.lingerTimer = window.setTimeout(() => {
        this.lingerTimer = null;
        this.el.classList.add("fading");
        this.fadeTimer = window.setTimeout(() => {
          this.fadeTimer = null;
          this._hide();
        }, FADE_MS);
      }, LINGER_MS);
    });
  }

  // Position the box around the stored anchor, clamped inside the parent.
  // Bottom-aligned with the anchor row: the box hugs the cursor line like
  // true inline composition, grows UPWARD as the composition wraps (bottom
  // edge stays flush), and its top stays clear of the OS candidate window
  // that pops just below the frozen textarea.
  private _place(): void {
    if (!this.anchor) return;
    const parentW = this.parent.clientWidth;
    const parentH = this.parent.clientHeight;
    const boxW = this.el.offsetWidth || 120;
    const boxH = this.el.offsetHeight || 28;
    const x = Math.max(4, Math.min(this.anchor.x, parentW - boxW - 4));
    const y = this.anchor.y + this.anchor.cellH - boxH;
    this.el.style.left = `${x}px`;
    this.el.style.top = `${Math.max(4, Math.min(y, parentH - boxH - 4))}px`;
  }

  private _hide(): void {
    this.active = false;
    this.anchor = null;
    this.el.classList.remove("fading");
    this.el.style.display = "none";
    this.el.textContent = "";
  }

  private _cancelBlurHide(): void {
    if (this.blurHideTimer !== null) {
      clearTimeout(this.blurHideTimer);
      this.blurHideTimer = null;
    }
  }

  private _cancelTimers(): void {
    this._cancelBlurHide();
    if (this.lingerTimer !== null) {
      clearTimeout(this.lingerTimer);
      this.lingerTimer = null;
    }
    if (this.fadeTimer !== null) {
      clearTimeout(this.fadeTimer);
      this.fadeTimer = null;
    }
    if (this.placeRaf !== null) {
      const caf = window.cancelAnimationFrame ?? clearTimeout;
      caf(this.placeRaf);
      this.placeRaf = null;
    }
  }

  destroy(): void {
    this._cancelTimers();
    this._hide(); // a destroyed box is inert: no composing/visible state
    if (this.windowBlurHandler) {
      window.removeEventListener("blur", this.windowBlurHandler);
      this.windowBlurHandler = null;
    }
    this.el.remove();
  }

  get isVisible(): boolean {
    return this.el.style.display !== "none";
  }

  // A composition is in flight (even while the box is hidden for an empty
  // string). Used to lock display ownership mid-composition.
  get isComposing(): boolean {
    return this.active;
  }

  get isFading(): boolean {
    return this.el.classList.contains("fading");
  }

  get text(): string {
    return this.el.textContent ?? "";
  }

  get position(): { left: string; top: string } {
    return { left: this.el.style.left, top: this.el.style.top };
  }
}
