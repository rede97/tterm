import { afterEach, describe, expect, it, vi } from "vitest";
import { attachTouchScroll, coastStep, TOUCH_SCROLL_SLOP } from "../src/terminal/touchscroll";

function pointer(type: string, init: PointerEventInit & { timeStamp?: number }): PointerEvent {
  const ev = new PointerEvent(type, { bubbles: true, pointerType: "touch", ...init });
  if (init.timeStamp !== undefined) {
    Object.defineProperty(ev, "timeStamp", { value: init.timeStamp });
  }
  return ev;
}

function harness() {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const scrolled: number[] = [];
  let cleared = 0;
  const detach = attachTouchScroll(
    element,
    {
      scrollLines: (n) => scrolled.push(n),
      clearSelection: () => {
        cleared++;
      },
    },
    () => 16,
  );
  return { element, scrolled, cleared: () => cleared, detach };
}

describe("coastStep", () => {
  it("decays velocity and reports the distance traveled", () => {
    const step = coastStep(1, 16);
    expect(step.delta).toBeGreaterThan(0);
    expect(Math.abs(step.velocity)).toBeLessThan(1);
  });

  it("stops when dt is zero", () => {
    expect(coastStep(1, 0)).toEqual({ velocity: 0, delta: 0 });
  });
});

describe("attachTouchScroll", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("scrolls a vertical swipe by whole cells and ignores a short drag", () => {
    const h = harness();
    h.element.dispatchEvent(pointer("pointerdown", { pointerId: 1, clientX: 20, clientY: 200 }));
    h.element.dispatchEvent(
      pointer("pointermove", { pointerId: 1, clientX: 20, clientY: 200 - TOUCH_SCROLL_SLOP + 1 }),
    );
    expect(h.scrolled).toEqual([]);

    h.element.dispatchEvent(
      pointer("pointermove", { pointerId: 1, clientX: 22, clientY: 200 - 40, timeStamp: 20 }),
    );
    // 40px up / 16px cell → 2 lines toward newer output. The slop move is included.
    expect(h.scrolled.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
    expect(h.cleared()).toBe(1);
    // The synthesized mousemove must not reach xterm's selection handler.
    let bubbled = false;
    h.element.addEventListener("mousemove", () => {
      bubbled = true;
    });
    h.element.dispatchEvent(
      new MouseEvent("mousemove", { bubbles: true, clientX: 22, clientY: 150 }),
    );
    expect(bubbled).toBe(false);
    expect(h.cleared()).toBe(2);
    h.detach();
  });

  it("a cancelled touch does not stick — the next swipe scrolls", () => {
    const h = harness();
    h.element.dispatchEvent(pointer("pointerdown", { pointerId: 1, clientX: 10, clientY: 200 }));
    h.element.dispatchEvent(
      pointer("pointermove", { pointerId: 1, clientX: 10, clientY: 160, timeStamp: 30 }),
    );
    const before = h.scrolled.reduce((a, b) => a + b, 0);
    expect(before).toBeGreaterThan(0);
    h.element.dispatchEvent(pointer("pointercancel", { pointerId: 1, clientX: 10, clientY: 160 }));

    h.element.dispatchEvent(pointer("pointerdown", { pointerId: 2, clientX: 10, clientY: 200 }));
    h.element.dispatchEvent(
      pointer("pointermove", { pointerId: 2, clientX: 10, clientY: 150, timeStamp: 80 }),
    );
    expect(h.scrolled.reduce((a, b) => a + b, 0)).toBeGreaterThan(before);
    h.detach();
  });

  it("a second finger interrupts the first swipe", () => {
    const h = harness();
    h.element.dispatchEvent(pointer("pointerdown", { pointerId: 1, clientX: 10, clientY: 200 }));
    h.element.dispatchEvent(
      pointer("pointermove", { pointerId: 1, clientX: 10, clientY: 160, timeStamp: 30 }),
    );
    h.element.dispatchEvent(pointer("pointerdown", { pointerId: 2, clientX: 12, clientY: 180 }));
    const mid = h.scrolled.length;
    h.element.dispatchEvent(
      pointer("pointermove", { pointerId: 1, clientX: 10, clientY: 100, timeStamp: 50 }),
    );
    expect(h.scrolled.length).toBe(mid);
    h.element.dispatchEvent(
      pointer("pointermove", { pointerId: 2, clientX: 12, clientY: 140, timeStamp: 70 }),
    );
    expect(h.scrolled.length).toBeGreaterThan(mid);
    h.detach();
  });

  it("a new touch stops an in-flight coast", () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      frames.push(cb);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      frames[id - 1] = () => {};
    });
    const h = harness();
    h.element.dispatchEvent(pointer("pointerdown", { pointerId: 1, clientX: 10, clientY: 200 }));
    h.element.dispatchEvent(
      pointer("pointermove", { pointerId: 1, clientX: 10, clientY: 120, timeStamp: 10 }),
    );
    h.element.dispatchEvent(
      pointer("pointermove", { pointerId: 1, clientX: 10, clientY: 40, timeStamp: 30 }),
    );
    h.element.dispatchEvent(
      pointer("pointerup", { pointerId: 1, clientX: 10, clientY: 40, timeStamp: 40 }),
    );
    expect(frames.length).toBe(1);
    const before = h.scrolled.reduce((a, b) => a + b, 0);
    frames[0](56);
    expect(h.scrolled.reduce((a, b) => a + b, 0)).toBeGreaterThan(before);

    h.element.dispatchEvent(pointer("pointerdown", { pointerId: 3, clientX: 10, clientY: 100 }));
    const afterInterrupt = frames.length;
    frames[frames.length - 1]?.(80);
    // The interrupted frame is a no-op; no further coast was queued.
    expect(frames.length).toBe(afterInterrupt);
    h.detach();
    vi.unstubAllGlobals();
  });

  it("ignores mouse pointers", () => {
    const h = harness();
    h.element.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        pointerId: 1,
        pointerType: "mouse",
        clientX: 10,
        clientY: 200,
      }),
    );
    h.element.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        pointerId: 1,
        pointerType: "mouse",
        clientX: 10,
        clientY: 100,
      }),
    );
    expect(h.scrolled).toEqual([]);
    h.detach();
  });
});
