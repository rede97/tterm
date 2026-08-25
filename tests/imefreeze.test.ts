// imefreeze geometry guards: transient invalid geometry (0-sized element,
// missing cell metrics) must NEVER pin the textarea to (0,0) — that placed
// the OS IME candidate window at the screen corner in actively-refreshing
// TUIs. See docs/ime-anchor-stability.md.
//
// happy-dom's CSSStyleDeclaration has a private-brand check that breaks the
// style Proxy, so the fake textarea carries a PLAIN style object (the freeze
// only does property writes, which are identical on plain objects).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { cellDimensionsMock, anchorCellMock } = vi.hoisted(() => ({
  cellDimensionsMock: vi.fn(),
  anchorCellMock: vi.fn(),
}));

vi.mock("../src/util/xterm-internals", () => ({
  cellDimensions: cellDimensionsMock,
  terminalTextarea: () => fakeTa.el,
  cursorIsHidden: () => false,
}));
vi.mock("../src/util/imeanchor", () => ({
  imeAnchorCell: anchorCellMock,
  cursorPixelPos: () => ({ x: 80, y: 80, cellH: 16 }),
}));

import { patchImeFreeze } from "../src/util/imefreeze";

// Fake textarea: real EventTarget (composition events) + plain style bag.
const fakeTa = (() => {
  const el = document.createElement("div");
  const style: Record<string, string> = {};
  Object.defineProperty(el, "style", { get: () => style, configurable: true });
  return { el, style };
})();

const terminal = {} as never;

function sizedElement(width: number, height: number): HTMLElement {
  const el = document.createElement("div");
  Object.defineProperty(el, "clientWidth", { value: width, configurable: true });
  Object.defineProperty(el, "clientHeight", { value: height, configurable: true });
  return el;
}

function compositionStart() {
  fakeTa.el.dispatchEvent(new Event("compositionstart", { bubbles: true }));
}

function compositionEnd() {
  fakeTa.el.dispatchEvent(new Event("compositionend", { bubbles: true }));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  for (const k of Object.keys(fakeTa.style)) delete fakeTa.style[k];
  document.body.appendChild(fakeTa.el);
  cellDimensionsMock.mockReturnValue({ width: 8, height: 16 });
  anchorCellMock.mockReturnValue({ x: 10, y: 5 });
});

afterEach(() => {
  compositionEnd();
  vi.useRealTimers();
  fakeTa.el.remove();
  // Unwrap the stacked style proxy: each patch wraps the previous one, and
  // a composition that never ended leaves stale frozen anchors in the old
  // closure. Restore the plain descriptor for the next test.
  Object.defineProperty(fakeTa.el, "style", {
    get: () => fakeTa.style,
    configurable: true,
  });
});

describe("imefreeze geometry guards", () => {
  it("freezes left/top at the anchor during composition", () => {
    const element = sizedElement(800, 600);
    const handle = patchImeFreeze(terminal, element, { position: () => null });
    compositionStart();
    // xterm's own writes during composition are clamped to the frozen anchor.
    fakeTa.el.style.left = "999px";
    fakeTa.el.style.top = "999px";
    expect(fakeTa.style.left).toBe("80px"); // 10 cells * 8px
    expect(fakeTa.style.top).toBe("80px"); // 5 rows * 16px
    handle.dispose();
  });

  it("skips re-anchor ticks with 0-sized element instead of writing (0,0)", () => {
    const element = sizedElement(800, 600);
    const handle = patchImeFreeze(terminal, element, { position: () => null });
    compositionStart();
    fakeTa.el.style.left = "999px"; // clamps to 80px (frozen)
    expect(fakeTa.style.left).toBe("80px");

    // Transient: layout churn reports a 0-sized element.
    Object.defineProperty(element, "clientWidth", { value: 0 });
    Object.defineProperty(element, "clientHeight", { value: 0 });
    vi.advanceTimersByTime(250); // a re-anchor tick fires
    expect(fakeTa.style.left).not.toBe("0px");
    expect(fakeTa.style.left).toBe("80px");
    handle.dispose();
  });

  it("skips re-anchor ticks when cell metrics vanish", () => {
    const element = sizedElement(800, 600);
    const handle = patchImeFreeze(terminal, element, { position: () => null });
    compositionStart();
    fakeTa.el.style.left = "999px";
    expect(fakeTa.style.left).toBe("80px");

    cellDimensionsMock.mockReturnValue(null); // renderer rebuild transient
    vi.advanceTimersByTime(250);
    expect(fakeTa.style.left).toBe("80px");
    handle.dispose();
  });

  it("compositionstart with invalid geometry does not clamp (no intervention beats wrong pin)", () => {
    const element = sizedElement(0, 0); // e.g. hidden tab
    const handle = patchImeFreeze(terminal, element, { position: () => null });
    compositionStart();
    fakeTa.el.style.left = "42px";
    fakeTa.el.style.top = "24px";
    // No frozen anchor: xterm's values pass through untouched — crucially
    // NOT clamped to 0px.
    expect(fakeTa.style.left).toBe("42px");
    expect(fakeTa.style.top).toBe("24px");
    handle.dispose();
  });

  it("blur mid-composition clears the freeze when compositionend never arrives", () => {
    const element = sizedElement(800, 600);
    const handle = patchImeFreeze(terminal, element, { position: () => null });
    compositionStart();
    fakeTa.el.style.left = "999px";
    expect(fakeTa.style.left).toBe("80px");
    fakeTa.el.dispatchEvent(new FocusEvent("blur"));
    vi.advanceTimersByTime(0);
    // Freeze dropped: subsequent xterm writes pass through.
    fakeTa.el.style.left = "42px";
    expect(fakeTa.style.left).toBe("42px");
    handle.dispose();
  });
});
