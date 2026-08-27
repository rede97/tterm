import { beforeEach, describe, expect, it } from "vitest";

import { attachOverlayScrollbar } from "../src/ui/overlay-scroll";

// jsdom has no layout: stub scroll metrics per element.
function scroller(metrics: {
  scrollHeight: number;
  clientHeight: number;
  scrollTop?: number;
}): HTMLElement {
  const el = document.createElement("div");
  Object.defineProperties(el, {
    scrollHeight: { value: metrics.scrollHeight, configurable: true },
    clientHeight: { value: metrics.clientHeight, configurable: true },
    scrollTop: { value: metrics.scrollTop ?? 0, configurable: true, writable: true },
  });
  document.body.appendChild(el);
  return el;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("overlay scrollbar (Q8b)", () => {
  it("hides when content fits; shows a proportional floating thumb when overflowing", () => {
    const el = scroller({ scrollHeight: 100, clientHeight: 100 });
    attachOverlayScrollbar(el);
    expect(el.querySelector(".ov-sb")!.classList.contains("on")).toBe(false);

    // Grow content: thumb appears with proportional height at top.
    Object.defineProperty(el, "scrollHeight", { value: 400 });
    el.dispatchEvent(new Event("scroll"));
    const bar = el.querySelector<HTMLElement>(".ov-sb")!;
    const thumb = el.querySelector<HTMLElement>(".ov-sb-thumb")!;
    expect(bar.classList.contains("on")).toBe(true);
    // trackH = 92; thumb = 100/400 * 92 = 23 → clamped to 24.
    expect(thumb.style.height).toBe("24px");
    expect(thumb.style.transform).toBe("translateY(4px)");
  });

  it("thumb tracks scrollTop; overscroll past the end stays clamped", () => {
    const el = scroller({ scrollHeight: 400, clientHeight: 100 });
    attachOverlayScrollbar(el);
    el.scrollTop = 300; // bottom
    el.dispatchEvent(new Event("scroll"));
    const bar = el.querySelector<HTMLElement>(".ov-sb")!;
    const thumb = el.querySelector<HTMLElement>(".ov-sb-thumb")!;
    // Sticky height-0 bar — no translateY pin (that used to grow scrollHeight).
    expect(bar.style.transform).toBe("");
    // thumb bottom-aligned: 4 + (92 - 24) = 72
    expect(thumb.style.transform).toBe("translateY(72px)");
    expect(el.classList.contains("ov-scroll")).toBe(true);

    el.scrollTop = 380; // past the end (rubber-band)
    el.dispatchEvent(new Event("scroll"));
    expect(thumb.style.transform).toBe("translateY(72px)");
  });

  it("re-attaches after a full content rebuild (Revert clears children)", () => {
    const el = scroller({ scrollHeight: 400, clientHeight: 100 });
    attachOverlayScrollbar(el);
    el.innerHTML = ""; // render(nothing) equivalent
    expect(el.querySelector(".ov-sb")).toBeNull();
    el.dispatchEvent(new Event("scroll"));
    expect(el.querySelector(".ov-sb")).not.toBeNull();
    expect(el.querySelector(".ov-sb")!.classList.contains("on")).toBe(true);
  });

  it("detach removes the bar and the scoped class", () => {
    const el = scroller({ scrollHeight: 400, clientHeight: 100 });
    const detach = attachOverlayScrollbar(el);
    detach();
    expect(el.querySelector(".ov-sb")).toBeNull();
    expect(el.classList.contains("ov-scroll")).toBe(false);
  });
});
