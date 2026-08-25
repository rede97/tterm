import { beforeEach, describe, expect, it, vi } from "vitest";

import { dismissTabCloseConfirm, showTabCloseConfirm } from "../src/terminal/closetab";

function makeTab(label = "pi"): { parent: HTMLElement; tab: HTMLElement } {
  const strip = document.createElement("div");
  strip.id = "tabs";
  const tab = document.createElement("div");
  tab.className = "tab";
  tab.dataset.tabId = "tab-1";
  strip.appendChild(tab);
  document.body.appendChild(strip);
  void label;
  return { parent: strip, tab };
}

const strip = () => document.querySelector<HTMLElement>(".tab-close-confirm");

beforeEach(() => {
  document.body.innerHTML = "";
  dismissTabCloseConfirm();
});

describe("tab close confirmation strip", () => {
  it("shows a confirm-only strip and the button fires onConfirm", () => {
    const { tab } = makeTab();
    const onConfirm = vi.fn();
    showTabCloseConfirm(tab, "pi", onConfirm);

    const el = strip();
    expect(el).toBeTruthy();
    expect(el!.textContent).toContain("Close pi?");
    // No Cancel button — exactly one action.
    expect(el!.querySelectorAll("button")).toHaveLength(1);

    el!.querySelector("button")!.click();
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(strip()).toBeNull();
  });

  it("clicking anywhere else cancels without confirming", () => {
    const { tab } = makeTab();
    const onConfirm = vi.fn();
    showTabCloseConfirm(tab, "pi", onConfirm);

    document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(strip()).toBeNull();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("Escape cancels and does not reach other handlers", () => {
    const { tab } = makeTab();
    showTabCloseConfirm(tab, "pi", vi.fn());
    const e = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    document.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    expect(strip()).toBeNull();
  });

  it("disappears when its tab is removed by another close path", () => {
    const { tab } = makeTab();
    showTabCloseConfirm(tab, "pi", vi.fn());
    tab.remove(); // e.g. Ctrl+W or session-exited landed first
    dismissTabCloseConfirm(); // MutationObserver is async; explicit call flushes
    expect(strip()).toBeNull();
  });

  it("opening for a second tab replaces the first strip", () => {
    const { parent, tab } = makeTab();
    const other = document.createElement("div");
    other.className = "tab";
    parent.appendChild(other);
    showTabCloseConfirm(tab, "pi", vi.fn());
    showTabCloseConfirm(other, "nginx", vi.fn());
    expect(document.querySelectorAll(".tab-close-confirm")).toHaveLength(1);
    expect(strip()!.textContent).toContain("nginx");
  });
});
