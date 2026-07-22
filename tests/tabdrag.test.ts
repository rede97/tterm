import { describe, it, expect, vi, beforeEach } from "vitest";
import { insertionIndex, attachTabDrag, DRAG_THRESHOLD_PX } from "../src/tabdrag";

describe("insertionIndex", () => {
  // three 100px-wide tabs starting at x=0,100,200
  const rects = [
    { left: 0, width: 100 },
    { left: 100, width: 100 },
    { left: 200, width: 100 },
  ];

  it("inserts before the first tab when center is left of its midpoint", () => {
    expect(insertionIndex(rects, 20)).toBe(0);
  });

  it("inserts between tabs when center is past a midpoint", () => {
    expect(insertionIndex(rects, 60)).toBe(1);   // past mid of tab0 (50)
    expect(insertionIndex(rects, 160)).toBe(2);  // past mid of tab1 (150)
  });

  it("appends at the end when past all midpoints", () => {
    expect(insertionIndex(rects, 260)).toBe(3);
  });

  it("handles empty sibling list", () => {
    expect(insertionIndex([], 100)).toBe(0);
  });
});

describe("attachTabDrag", () => {
  let container: HTMLElement;
  let tabs: HTMLElement[];

  function mockRect(el: HTMLElement, left: number, width = 100) {
    el.getBoundingClientRect = () =>
      ({ left, width, right: left + width, top: 0, bottom: 32, height: 32, x: left, y: 0, toJSON: () => ({}) }) as DOMRect;
  }

  beforeEach(() => {
    document.body.innerHTML = "";
    container = document.createElement("div");
    document.body.appendChild(container);
    tabs = [];
    for (let i = 0; i < 3; i++) {
      const t = document.createElement("div");
      t.className = "tab";
      t.dataset.tabId = `tab-${i + 1}`;
      container.appendChild(t);
      tabs.push(t);
    }
  });

  function siblings(except: HTMLElement) {
    return tabs.filter(t => t !== except);
  }

  function drag(el: HTMLElement, fromX: number, toX: number) {
    el.dispatchEvent(new PointerEvent("pointerdown", { button: 0, clientX: fromX, bubbles: true }));
    el.dispatchEvent(new PointerEvent("pointermove", { clientX: toX, bubbles: true }));
    el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
  }

  it("does nothing below the drag threshold (click passes through)", () => {
    const onReorder = vi.fn();
    const onDrop = vi.fn();
    attachTabDrag(tabs[0], () => siblings(tabs[0]), () => null, { onReorder, onDrop });
    drag(tabs[0], 100, 100 + DRAG_THRESHOLD_PX - 1);
    expect(onReorder).not.toHaveBeenCalled();
    expect(onDrop).not.toHaveBeenCalled();
    expect(tabs[0].classList.contains("dragging")).toBe(false);
  });

  it("reorders DOM when dragged past a sibling midpoint and fires onDrop", () => {
    const onDrop = vi.fn();
    // static layout: tab1@0, tab2@100, tab3@200
    mockRect(tabs[0], 0); mockRect(tabs[1], 100); mockRect(tabs[2], 200);
    attachTabDrag(
      tabs[0],
      () => siblings(tabs[0]),
      () => null,
      { onReorder: (before) => container.insertBefore(tabs[0], before), onDrop },
    );

    // drag tab1 right past tab2's midpoint (150)
    mockRect(tabs[0], 160); // simulated dragged position
    drag(tabs[0], 50, 260);

    expect(onDrop).toHaveBeenCalledTimes(1);
    const order = [...container.children].map(c => (c as HTMLElement).dataset.tabId);
    expect(order).toEqual(["tab-2", "tab-1", "tab-3"]);
    expect(tabs[0].classList.contains("dragging")).toBe(false);
    expect(tabs[0].style.transform).toBe("");
  });

  it("ignores non-left buttons and close-button presses", () => {
    const onDrop = vi.fn();
    attachTabDrag(tabs[0], () => siblings(tabs[0]), () => null, { onReorder: vi.fn(), onDrop });

    // right button
    tabs[0].dispatchEvent(new PointerEvent("pointerdown", { button: 2, clientX: 0, bubbles: true }));
    tabs[0].dispatchEvent(new PointerEvent("pointermove", { clientX: 200, bubbles: true }));
    tabs[0].dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));

    // close button as target
    const close = document.createElement("button");
    close.className = "tab-close";
    tabs[0].appendChild(close);
    close.dispatchEvent(new PointerEvent("pointerdown", { button: 0, clientX: 0, bubbles: true }));
    tabs[0].dispatchEvent(new PointerEvent("pointermove", { clientX: 200, bubbles: true }));
    tabs[0].dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));

    expect(onDrop).not.toHaveBeenCalled();
  });

  it("pointercancel settles the drag without leaving a stale transform", () => {
    const onDrop = vi.fn();
    mockRect(tabs[0], 0); mockRect(tabs[1], 100); mockRect(tabs[2], 200);
    attachTabDrag(
      tabs[0],
      () => siblings(tabs[0]),
      () => null,
      { onReorder: (before) => container.insertBefore(tabs[0], before), onDrop },
    );

    tabs[0].dispatchEvent(new PointerEvent("pointerdown", { button: 0, clientX: 50, bubbles: true }));
    mockRect(tabs[0], 160);
    tabs[0].dispatchEvent(new PointerEvent("pointermove", { clientX: 260, bubbles: true }));
    expect(tabs[0].classList.contains("dragging")).toBe(true);

    // capture lost mid-drag (e.g. mouse released outside the window)
    tabs[0].dispatchEvent(new PointerEvent("pointercancel", { bubbles: true }));
    expect(onDrop).toHaveBeenCalledTimes(1);
    expect(tabs[0].style.transform).toBe("");
    expect(tabs[0].classList.contains("dragging")).toBe(false);
  });
});
