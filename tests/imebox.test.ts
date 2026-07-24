import { describe, it, expect, beforeEach } from "vitest";
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
  });

  it("shows on compositionstart, mirrors updates, hides on end", () => {
    const { textarea, box } = setup();
    box.attach(textarea, () => ({ x: 10, y: 20, cellH: 16 }));
    expect(box.isVisible).toBe(false);
    composition(textarea, "compositionstart");
    expect(box.isVisible).toBe(true);
    composition(textarea, "compositionupdate", "你好");
    expect(box.text).toBe("你好");
    composition(textarea, "compositionend", "你好");
    expect(box.isVisible).toBe(false);
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

  it("flips above the cursor line when near the bottom", () => {
    const { textarea, box } = setup(400, 100);
    box.attach(textarea, () => ({ x: 10, y: 90, cellH: 16 }));
    composition(textarea, "compositionstart");
    const top = parseInt(box.position.top, 10);
    expect(top).toBeLessThan(90); // flipped above
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
