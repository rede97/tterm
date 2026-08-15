import { describe, expect, it, vi } from "vitest";
import { handleMenuKeydown, isShown, menuItems, restoreFocus } from "../src/ui/menukeys";

function buildMenu(): HTMLElement {
  document.body.innerHTML = `
    <div id="m">
      <button id="a">A</button>
      <button id="b" disabled>B</button>
      <div style="display:none"><button id="c">C</button></div>
      <button id="d">D</button>
    </div>`;
  return document.getElementById("m") as HTMLElement;
}

function key(k: string): KeyboardEvent {
  return new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true });
}

function byId(id: string): HTMLElement {
  return document.getElementById(id) as HTMLElement;
}

describe("menuItems / isShown", () => {
  it("collects only visible, enabled buttons in DOM order", () => {
    const m = buildMenu();
    expect(menuItems(m).map((b) => b.id)).toEqual(["a", "d"]);
    expect(isShown(byId("a"))).toBe(true);
    expect(isShown(byId("c"))).toBe(false);
  });
});

describe("handleMenuKeydown", () => {
  function setup() {
    const m = buildMenu();
    const close = vi.fn();
    const h = { items: () => menuItems(m), close };
    return { m, close, h };
  }

  it("ArrowDown/ArrowUp move between usable entries and wrap at the edges", () => {
    const { h } = setup();
    byId("a").focus();
    handleMenuKeydown(key("ArrowDown"), h);
    expect(document.activeElement).toBe(byId("d")); // disabled/hidden skipped
    handleMenuKeydown(key("ArrowDown"), h);
    expect(document.activeElement).toBe(byId("a")); // wraps
    handleMenuKeydown(key("ArrowUp"), h);
    expect(document.activeElement).toBe(byId("d")); // wraps back
  });

  it("Home/End jump to the first/last entry", () => {
    const { h } = setup();
    byId("d").focus();
    handleMenuKeydown(key("Home"), h);
    expect(document.activeElement).toBe(byId("a"));
    handleMenuKeydown(key("End"), h);
    expect(document.activeElement).toBe(byId("d"));
  });

  it("Enter activates the focused entry exactly once", () => {
    const { h } = setup();
    const a = byId("a");
    const onClick = vi.fn();
    a.addEventListener("click", onClick);
    a.focus();
    const e = key("Enter");
    expect(handleMenuKeydown(e, h)).toBe(true);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(e.defaultPrevented).toBe(true); // native button click suppressed
  });

  it("Space activates the focused entry", () => {
    const { h } = setup();
    const d = byId("d");
    const onClick = vi.fn();
    d.addEventListener("click", onClick);
    d.focus();
    handleMenuKeydown(key(" "), h);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("Escape closes the menu", () => {
    const { close, h } = setup();
    byId("a").focus();
    const e = key("Escape");
    expect(handleMenuKeydown(e, h)).toBe(true);
    expect(close).toHaveBeenCalledTimes(1);
    expect(e.defaultPrevented).toBe(true);
  });

  it("ignores unrelated keys", () => {
    const { h } = setup();
    byId("a").focus();
    expect(handleMenuKeydown(key("x"), h)).toBe(false);
  });

  it("Enter with focus outside the entries is not consumed", () => {
    const { h } = setup();
    (document.body as HTMLElement).focus?.();
    expect(handleMenuKeydown(key("Enter"), h)).toBe(false);
  });
});

describe("restoreFocus", () => {
  it("refocuses a connected, focusable trigger", () => {
    buildMenu();
    const a = byId("a");
    restoreFocus(a);
    expect(document.activeElement).toBe(a);
  });

  it("refuses detached or non-focusable elements", () => {
    buildMenu();
    const a = byId("a");
    const detached = document.createElement("button");
    restoreFocus(detached);
    expect(document.activeElement).not.toBe(detached);
    // A non-focusable target leaves focus where it is (never moves it).
    a.focus();
    restoreFocus(document.body);
    expect(document.activeElement).toBe(a);
  });
});
