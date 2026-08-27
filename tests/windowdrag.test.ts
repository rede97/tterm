import { beforeEach, describe, expect, it, vi } from "vitest";
import { attachWindowDrag, isWindowDragChrome } from "../src/ui/windowdrag";

function mountBar(): {
  bar: HTMLElement;
  spacer: HTMLElement;
  tab: HTMLElement;
  btn: HTMLButtonElement;
} {
  document.body.innerHTML = `
    <div id="tab-bar">
      <div id="tabs"><div class="tab" data-tab-id="tab-1">local</div></div>
      <div id="drag-spacer"></div>
      <button id="btn-minimize">min</button>
    </div>`;
  return {
    bar: document.getElementById("tab-bar")!,
    spacer: document.getElementById("drag-spacer")!,
    tab: document.querySelector(".tab")!,
    btn: document.getElementById("btn-minimize") as HTMLButtonElement,
  };
}

function mouse(type: string, target: EventTarget, x: number, y = 8): MouseEvent {
  const e = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    buttons: type === "mouseup" ? 0 : 1,
    clientX: x,
    clientY: y,
  });
  target.dispatchEvent(e);
  return e;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("isWindowDragChrome", () => {
  it("is the empty drag spacer, not tabs or window buttons", () => {
    const { spacer, tab, btn, bar } = mountBar();
    expect(isWindowDragChrome(spacer)).toBe(true);
    expect(isWindowDragChrome(bar)).toBe(true);
    expect(isWindowDragChrome(tab)).toBe(false);
    expect(isWindowDragChrome(btn)).toBe(false);
  });
});

describe("attachWindowDrag", () => {
  it("prevents default on spacer mousedown so xterm is not blurred", () => {
    const { bar, spacer } = mountBar();
    const keepFocus = vi.fn();
    attachWindowDrag(bar, { startDrag: vi.fn(), keepFocus });
    const e = mouse("mousedown", spacer, 40);
    expect(e.defaultPrevented).toBe(true);
    expect(keepFocus).toHaveBeenCalledTimes(1);
  });

  it("does not hijack mousedown on a tab or a window button", () => {
    const { bar, tab, btn } = mountBar();
    const keepFocus = vi.fn();
    const startDrag = vi.fn();
    attachWindowDrag(bar, { startDrag, keepFocus });
    expect(mouse("mousedown", tab, 10).defaultPrevented).toBe(false);
    expect(mouse("mousedown", btn, 200).defaultPrevented).toBe(false);
    expect(keepFocus).not.toHaveBeenCalled();
    expect(startDrag).not.toHaveBeenCalled();
  });

  it("starts a window drag only after the pointer actually moves", () => {
    const { bar, spacer } = mountBar();
    const keepFocus = vi.fn();
    const startDrag = vi.fn();
    attachWindowDrag(bar, { startDrag, keepFocus });
    mouse("mousedown", spacer, 40);
    document.dispatchEvent(
      new MouseEvent("mousemove", { bubbles: true, clientX: 42, clientY: 8, buttons: 1 }),
    );
    expect(startDrag).not.toHaveBeenCalled();
    document.dispatchEvent(
      new MouseEvent("mousemove", { bubbles: true, clientX: 80, clientY: 8, buttons: 1 }),
    );
    expect(startDrag).toHaveBeenCalledTimes(1);
  });

  it("restores focus on mouseup when the pointer never moved enough to drag", () => {
    const { bar, spacer } = mountBar();
    const keepFocus = vi.fn();
    attachWindowDrag(bar, { startDrag: vi.fn(), keepFocus });
    mouse("mousedown", spacer, 40);
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: 41, clientY: 8 }));
    expect(keepFocus).toHaveBeenCalledTimes(2);
  });
});
