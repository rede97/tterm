import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ImeBox } from "../src/util/imebox";

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
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows on compositionstart, mirrors updates, lingers then fades on end", () => {
    const { textarea, box } = setup();
    box.attach(textarea, () => ({ x: 10, y: 20, cellH: 16 }));
    expect(box.isVisible).toBe(false);
    composition(textarea, "compositionstart");
    expect(box.isVisible).toBe(true);
    composition(textarea, "compositionupdate", "你好");
    expect(box.text).toBe("你好");
    composition(textarea, "compositionend", "你好");
    // linger: still visible right after commit
    expect(box.isVisible).toBe(true);
    expect(box.isFading).toBe(false);
    vi.advanceTimersByTime(400);
    expect(box.isVisible).toBe(true);
    expect(box.isFading).toBe(true);
    vi.advanceTimersByTime(250);
    expect(box.isVisible).toBe(false);
    expect(box.isFading).toBe(false);
  });

  it("a new composition cancels a pending fade and shows immediately", () => {
    const { textarea, box } = setup();
    box.attach(textarea, () => ({ x: 10, y: 20, cellH: 16 }));
    composition(textarea, "compositionstart");
    composition(textarea, "compositionend", "a");
    vi.advanceTimersByTime(400); // now fading
    expect(box.isFading).toBe(true);
    composition(textarea, "compositionstart");
    expect(box.isVisible).toBe(true);
    expect(box.isFading).toBe(false);
    vi.advanceTimersByTime(1000); // stale timers must not hide it
    expect(box.isVisible).toBe(true);
  });

  it("does not show when shouldMirror returns false", () => {
    const { textarea, box } = setup();
    box.attach(textarea, () => ({ x: 10, y: 20, cellH: 16 }), () => false);
    composition(textarea, "compositionstart");
    composition(textarea, "compositionupdate", "nihao");
    expect(box.isVisible).toBe(false);
    expect(box.text).toBe("");
  });

  it("shouldMirror is evaluated per composition (live gate)", () => {
    const { textarea, box } = setup();
    let allow = false;
    box.attach(textarea, () => ({ x: 10, y: 20, cellH: 16 }), () => allow);
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

  it("places above the anchor line by default (dodges the OS candidate window)", () => {
    const { textarea, box } = setup(400, 300);
    box.attach(textarea, () => ({ x: 10, y: 90, cellH: 16 }));
    composition(textarea, "compositionstart");
    // happy-dom reports 0 size → fallback boxH=28; above = 90 - 28 - 2 = 60
    expect(parseInt(box.position.top, 10)).toBe(60);
  });

  it("flips below the anchor line only when there is no room above", () => {
    const { textarea, box } = setup(400, 300);
    box.attach(textarea, () => ({ x: 10, y: 10, cellH: 16 }));
    composition(textarea, "compositionstart");
    // 10 - 28 - 2 < 4 → below = 10 + 16 + 2 = 28
    expect(parseInt(box.position.top, 10)).toBe(28);
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
