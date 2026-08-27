import { beforeEach, describe, expect, it, vi } from "vitest";

import { dismissTabCloseConfirm, showTabCloseConfirm } from "../src/terminal/closetab";

function makeTab(label = "pi"): { parent: HTMLElement; tab: HTMLElement } {
  const strip = document.createElement("div");
  strip.id = "tabs";
  const tab = document.createElement("div");
  tab.className = "tab";
  tab.dataset.tabId = "tab-1";
  const badge = document.createElement("span");
  badge.className = "tab-badge";
  badge.textContent = "1";
  const labelEl = document.createElement("span");
  labelEl.className = "tab-label";
  labelEl.textContent = label;
  const close = document.createElement("button");
  close.className = "tab-close";
  close.textContent = "×";
  tab.append(badge, labelEl, close);
  strip.appendChild(tab);
  document.body.appendChild(strip);
  return { parent: strip, tab };
}

const confirmBtn = () => document.querySelector<HTMLButtonElement>(".tab-close-confirm-btn");

beforeEach(() => {
  document.body.innerHTML = "";
  dismissTabCloseConfirm();
});

describe("tab close confirmation (expanding X)", () => {
  it("shows an X over the × and the button fires onConfirm", () => {
    const { tab } = makeTab();
    const onConfirm = vi.fn();
    showTabCloseConfirm(tab, "pi", onConfirm);

    expect(tab.classList.contains("confirming")).toBe(true);
    const btn = confirmBtn();
    expect(btn).toBeTruthy();
    expect(btn!.textContent).toBe("");
    expect(btn!.querySelector("svg")).toBeTruthy();
    expect(btn!.getAttribute("aria-label")).toBe("Close pi?");

    btn!.click();
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(confirmBtn()).toBeNull();
    expect(tab.classList.contains("confirming")).toBe(false);
  });

  it("clicking anywhere else cancels without confirming", () => {
    const { tab } = makeTab();
    const onConfirm = vi.fn();
    showTabCloseConfirm(tab, "pi", onConfirm);

    document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(confirmBtn()).toBeNull();
    expect(tab.classList.contains("confirming")).toBe(false);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("Escape cancels and does not reach other handlers", () => {
    const { tab } = makeTab();
    showTabCloseConfirm(tab, "pi", vi.fn());
    const e = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    document.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    expect(confirmBtn()).toBeNull();
  });

  it("disappears when its tab is removed by another close path", () => {
    const { tab } = makeTab();
    showTabCloseConfirm(tab, "pi", vi.fn());
    tab.remove();
    dismissTabCloseConfirm();
    expect(confirmBtn()).toBeNull();
  });

  it("opening for a second tab replaces the first confirm", () => {
    const { parent, tab } = makeTab();
    const other = document.createElement("div");
    other.className = "tab";
    const labelEl = document.createElement("span");
    labelEl.className = "tab-label";
    labelEl.textContent = "nginx";
    other.appendChild(labelEl);
    parent.appendChild(other);
    showTabCloseConfirm(tab, "pi", vi.fn());
    showTabCloseConfirm(other, "nginx", vi.fn());
    expect(document.querySelectorAll(".tab-close-confirm-btn")).toHaveLength(1);
    expect(tab.classList.contains("confirming")).toBe(false);
    expect(other.classList.contains("confirming")).toBe(true);
  });
});
