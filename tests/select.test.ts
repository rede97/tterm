import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "../src/ui/lit";
import { closeAllSelects, ttSelect } from "../src/ui/select";

// Q8 (docs/ui/parity-gap.md): the listbox floats position:fixed, pinned to
// the trigger's viewport rect — it must never grow the panel's scrollHeight
// or spawn a panel scrollbar. Scrolling any container (except the menu
// itself) closes it.

function mountSelect(): { host: HTMLElement; root: HTMLElement } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  render(
    ttSelect(
      "Baud",
      [
        ["9600", "9600"],
        ["115200", "115200"],
      ],
      "115200",
      vi.fn(),
    ),
    host,
  );
  const root = host.querySelector<HTMLElement>(".tt-select")!;
  return { host, root };
}

// An open menu is portaled to <body> (Q8) — look beyond the select root.
const menuOf = (_root: HTMLElement) =>
  document.querySelector<HTMLElement>("body > .tt-select-menu")!;
const openSelect = (root: HTMLElement) =>
  root.querySelector<HTMLElement>(".tt-select-trigger")!.click();

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("custom select — floating menu (Q8)", () => {
  it("opening pins the menu in viewport space with inline geometry", () => {
    const { root } = mountSelect();
    openSelect(root);
    const menu = menuOf(root);
    expect(root.classList.contains("open")).toBe(true);
    // Regression (visibility): portaled to <body> the menu is outside the
    // .tt-select.open descendant selector — it must carry its own .open or
    // it stays display:none forever.
    expect(menu.parentElement).toBe(document.body);
    expect(menu.classList.contains("open")).toBe(true);
    // jsdom rects are all 0: left/width pin to the trigger, top = bottom+4.
    expect(menu.style.width).toBe("0px");
    expect(menu.style.left).toBe("0px");
    expect(menu.style.top).toBe("4px");
    expect(menu.style.bottom).toBe("auto");
    expect(menu.dataset.drop).toBe("down");
    // Never absolutely positioned inside the panel flow (CSS: fixed).
    expect(menu.style.position).toBe("");
  });

  it("scrolling an outside container closes the menu; menu scroll exempt", () => {
    const { root } = mountSelect();
    openSelect(root);
    // The menu's own max-height scrolling must not close it.
    menuOf(root).dispatchEvent(new Event("scroll", { bubbles: true }));
    expect(root.classList.contains("open")).toBe(true);
    // Any other scroll (panel, terminal viewport, settings page) closes it.
    document.body.dispatchEvent(new Event("scroll", { bubbles: true }));
    expect(root.classList.contains("open")).toBe(false);
  });

  it("window resize closes the menu", () => {
    const { root } = mountSelect();
    openSelect(root);
    window.dispatchEvent(new Event("resize"));
    expect(root.classList.contains("open")).toBe(false);
  });

  it("closeAllSelects keeps the named select open", () => {
    const a = mountSelect();
    const b = mountSelect();
    openSelect(a.root);
    openSelect(b.root);
    // Opening B already closed A (single-open rule).
    expect(a.root.classList.contains("open")).toBe(false);
    expect(b.root.classList.contains("open")).toBe(true);
    closeAllSelects();
    expect(b.root.classList.contains("open")).toBe(false);
  });

  it("picking an option closes and unportals the menu", () => {
    const { root } = mountSelect();
    openSelect(root);
    expect(menuOf(root).classList.contains("open")).toBe(true);
    menuOf(root).querySelector<HTMLElement>('.tt-option[data-value="9600"]')!.click();
    expect(root.classList.contains("open")).toBe(false);
    expect(document.querySelector("body > .tt-select-menu.open")).toBeNull();
    expect(root.querySelector(".tt-select-menu")).not.toBeNull();
  });
});
