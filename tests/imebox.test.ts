import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ImeBox, setImeDebugFlags } from "../src/util/imebox";

function setup(width = 400, height = 300) {
  document.body.innerHTML = "";
  const parent = document.createElement("div");
  Object.defineProperty(parent, "clientWidth", { value: width });
  Object.defineProperty(parent, "clientHeight", { value: height });
  document.body.appendChild(parent);
  const textarea = document.createElement("textarea");
  parent.appendChild(textarea);
  const box = new ImeBox(parent);
  return { parent, textarea, box };
}

function composition(textarea: HTMLElement, type: string, data = "") {
  const ev = new CompositionEvent(type, { data });
  // happy-dom ignores the init dict's data field
  if (ev.data !== data) Object.defineProperty(ev, "data", { value: data });
  textarea.dispatchEvent(ev);
}

describe("ImeBox", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.useFakeTimers();
    // deterministic defaults regardless of the module-level debug default
    setImeDebugFlags({ suppress: true, reanchor: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows on compositionstart, mirrors updates, hides after commit", () => {
    const { textarea, box } = setup();
    box.attach(textarea, () => ({ x: 10, y: 20, cellH: 16 }));
    expect(box.isVisible).toBe(false);
    composition(textarea, "compositionstart");
    expect(box.isVisible).toBe(true);
    composition(textarea, "compositionupdate", "你好");
    expect(box.text).toBe("你好");
    composition(textarea, "compositionend", "你好");
    // hide is deferred to the timer chain even with 0ms linger/fade
    expect(box.isVisible).toBe(true);
    vi.advanceTimersByTime(1);
    expect(box.isVisible).toBe(false);
    expect(box.isFading).toBe(false);
  });

  it("a cancelled composition (Esc) hides immediately without lingering", () => {
    const { textarea, box } = setup();
    box.attach(textarea, () => ({ x: 10, y: 20, cellH: 16 }));
    composition(textarea, "compositionstart");
    composition(textarea, "compositionupdate", "ni");
    composition(textarea, "compositionupdate", ""); // IME clears the string
    expect(box.isVisible).toBe(false); // empty shell hidden
    composition(textarea, "compositionend", ""); // cancel: nothing committed
    expect(box.isVisible).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(box.isVisible).toBe(false); // no linger, no fade
  });

  it("empty compositionend hides immediately even if preedit text remains", () => {
    const { textarea, box } = setup();
    box.attach(textarea, () => ({ x: 10, y: 20, cellH: 16 }));
    composition(textarea, "compositionstart");
    composition(textarea, "compositionupdate", "nihao");
    expect(box.isVisible).toBe(true);
    composition(textarea, "compositionend", ""); // cancel without clearing update
    expect(box.isVisible).toBe(false);
    expect(box.isComposing).toBe(false);
  });

  it("blur mid-composition hides the mirror without waiting for compositionend", () => {
    const { textarea, box } = setup();
    box.attach(textarea, () => ({ x: 10, y: 20, cellH: 16 }));
    composition(textarea, "compositionstart");
    composition(textarea, "compositionupdate", "ni");
    expect(box.isVisible).toBe(true);
    textarea.dispatchEvent(new FocusEvent("blur"));
    // deferred one tick — compositionend never arrives
    expect(box.isVisible).toBe(true);
    vi.advanceTimersByTime(0);
    expect(box.isVisible).toBe(false);
    expect(box.isComposing).toBe(false);
  });

  it("blur hide is cancelled if focus returns in the same turn", () => {
    const { textarea, box } = setup();
    box.attach(textarea, () => ({ x: 10, y: 20, cellH: 16 }));
    composition(textarea, "compositionstart");
    composition(textarea, "compositionupdate", "ni");
    textarea.dispatchEvent(new FocusEvent("blur"));
    textarea.dispatchEvent(new FocusEvent("focus")); // candidate-window click
    vi.advanceTimersByTime(0);
    expect(box.isVisible).toBe(true);
    expect(box.text).toBe("ni");
  });

  it("blur hide is cancelled if compositionend arrives in the same turn", () => {
    const { textarea, box } = setup();
    box.attach(textarea, () => ({ x: 10, y: 20, cellH: 16 }));
    composition(textarea, "compositionstart");
    composition(textarea, "compositionupdate", "ni");
    textarea.dispatchEvent(new FocusEvent("blur"));
    composition(textarea, "compositionend", "你"); // successful commit after blur
    vi.advanceTimersByTime(0); // blur hide must not clobber linger
    expect(box.isVisible).toBe(true);
    vi.advanceTimersByTime(1);
    expect(box.isVisible).toBe(false);
  });

  it("hides while the composition string is empty, reappears on new input", () => {
    const { textarea, box } = setup();
    box.attach(textarea, () => ({ x: 10, y: 20, cellH: 16 }));
    composition(textarea, "compositionstart");
    composition(textarea, "compositionupdate", "ni");
    expect(box.isVisible).toBe(true);
    composition(textarea, "compositionupdate", "");
    expect(box.isVisible).toBe(false); // hidden, still active
    composition(textarea, "compositionupdate", "n");
    expect(box.isVisible).toBe(true);
    expect(box.text).toBe("n");
    composition(textarea, "compositionend", "你");
    expect(box.isVisible).toBe(true); // real commit still lingers
    vi.advanceTimersByTime(650);
    expect(box.isVisible).toBe(false);
  });

  it("a new composition cancels a pending hide and shows immediately", () => {
    const { textarea, box } = setup();
    box.attach(textarea, () => ({ x: 10, y: 20, cellH: 16 }));
    composition(textarea, "compositionstart");
    composition(textarea, "compositionend", "a"); // hide timers pending
    composition(textarea, "compositionstart"); // cancels them synchronously
    expect(box.isVisible).toBe(true);
    expect(box.isFading).toBe(false);
    vi.advanceTimersByTime(1000); // stale timers must not hide it
    expect(box.isVisible).toBe(true);
  });

  it("does not show when shouldMirror returns false", () => {
    const { textarea, box } = setup();
    box.attach(
      textarea,
      () => ({ x: 10, y: 20, cellH: 16 }),
      () => false,
    );
    composition(textarea, "compositionstart");
    composition(textarea, "compositionupdate", "nihao");
    expect(box.isVisible).toBe(false);
    expect(box.text).toBe("");
  });

  it("shouldMirror is evaluated per composition (live gate)", () => {
    const { textarea, box } = setup();
    let allow = false;
    box.attach(
      textarea,
      () => ({ x: 10, y: 20, cellH: 16 }),
      () => allow,
    );
    composition(textarea, "compositionstart");
    expect(box.isVisible).toBe(false);
    allow = true;
    composition(textarea, "compositionstart");
    expect(box.isVisible).toBe(true);
  });

  it("anchors once: position captured at start, not recomputed on updates", () => {
    const { textarea, box } = setup();
    let y = 20;
    box.attach(textarea, () => ({ x: 10, y, cellH: 16 }));
    composition(textarea, "compositionstart");
    const posAfterStart = box.position;
    y = 200; // cursor "moved" mid-composition
    composition(textarea, "compositionupdate", "abc");
    expect(box.position).toEqual(posAfterStart); // must not drift
  });

  it("bottom-aligns with the anchor row and grows upward as the box grows", () => {
    const { parent, textarea, box } = setup(400, 300);
    const el = parent.querySelector(".ime-box") as HTMLElement;
    Object.defineProperty(el, "offsetHeight", { value: 28, configurable: true });
    box.attach(textarea, () => ({ x: 10, y: 100, cellH: 16 }));
    composition(textarea, "compositionstart");
    // bottom edge flush with the anchor row bottom: 100 + 16 - 28 = 88
    expect(parseInt(box.position.top, 10)).toBe(88);
    composition(textarea, "compositionend", "你");
    vi.advanceTimersByTime(650); // hide

    // box grew (multi-line wrap): extends upward, bottom stays flush
    Object.defineProperty(el, "offsetHeight", { value: 76, configurable: true });
    composition(textarea, "compositionstart");
    expect(parseInt(box.position.top, 10)).toBe(100 + 16 - 76);
  });

  it("clamps horizontally inside the parent", () => {
    const { textarea, box } = setup(200, 300);
    box.attach(textarea, () => ({ x: 9999, y: 10, cellH: 16 }));
    composition(textarea, "compositionstart");
    expect(parseInt(box.position.left, 10)).toBeLessThan(9999);
  });

  it("destroy removes the element", () => {
    const { parent, box } = setup();
    box.destroy();
    expect(parent.querySelector(".ime-box")).toBeNull();
  });
});
