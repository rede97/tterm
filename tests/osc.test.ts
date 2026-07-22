import { describe, it, expect } from "vitest";
import { parseOsc9Progress, applyProgressToTabElement } from "../src/osc";

describe("parseOsc9Progress", () => {
  it("parses normal progress", () => {
    expect(parseOsc9Progress("4;1;50")).toEqual({ state: 1, progress: 50 });
  });

  it("parses hidden state without progress value", () => {
    expect(parseOsc9Progress("4;0;")).toEqual({ state: 0, progress: 0 });
    expect(parseOsc9Progress("4;0")).toEqual({ state: 0, progress: 0 });
  });

  it("parses error / indeterminate / warning states", () => {
    expect(parseOsc9Progress("4;2;75")).toEqual({ state: 2, progress: 75 });
    expect(parseOsc9Progress("4;3;0")).toEqual({ state: 3, progress: 0 });
    expect(parseOsc9Progress("4;4;30")).toEqual({ state: 4, progress: 30 });
  });

  it("clamps progress to 0-100", () => {
    expect(parseOsc9Progress("4;1;250")).toEqual({ state: 1, progress: 100 });
    expect(parseOsc9Progress("4;1;-5")).toEqual({ state: 1, progress: 0 });
  });

  it("rejects non-progress OSC 9 subtypes", () => {
    expect(parseOsc9Progress("9;1;Something")).toBeNull(); // ConEmu misc
    expect(parseOsc9Progress("")).toBeNull();
  });

  it("rejects malformed sequences", () => {
    expect(parseOsc9Progress("4;9;50")).toBeNull();   // state out of range
    expect(parseOsc9Progress("4;x;50")).toBeNull();   // non-numeric state
    expect(parseOsc9Progress("4;1;abc")).toBeNull();  // non-numeric progress
  });

  it("contract: parses every sequence the Rust demo TTY can emit", () => {
    // demo_loop phases: (3,0), (1,0..100), (4,100), (2,100), (0,100)
    const emitted = ["4;3;0", "4;1;0", "4;1;42", "4;1;100", "4;4;100", "4;2;100", "4;0;100"];
    for (const data of emitted) {
      const p = parseOsc9Progress(data);
      expect(p, data).not.toBeNull();
      expect(p!.state).toBe(Number(data.split(";")[1]));
    }
  });
});

describe("applyProgressToTabElement", () => {
  function makeTab(): HTMLElement {
    const el = document.createElement("div");
    el.className = "tab";
    document.body.appendChild(el);
    return el;
  }

  it("creates a progress bar lazily with correct width", () => {
    const tab = makeTab();
    applyProgressToTabElement(tab, 1, 42);
    const bar = tab.querySelector(".tab-progress") as HTMLElement;
    expect(bar).toBeTruthy();
    expect(bar.style.width).toBe("42%");
    expect(bar.classList.contains("state-normal")).toBe(true);
  });

  it("updates width and state class on subsequent calls", () => {
    const tab = makeTab();
    applyProgressToTabElement(tab, 1, 10);
    applyProgressToTabElement(tab, 2, 80);
    const bar = tab.querySelector(".tab-progress") as HTMLElement;
    expect(bar.style.width).toBe("80%");
    expect(bar.classList.contains("state-error")).toBe(true);
    expect(tab.querySelectorAll(".tab-progress")).toHaveLength(1);
  });

  it("indeterminate state clears explicit width for CSS animation", () => {
    const tab = makeTab();
    applyProgressToTabElement(tab, 1, 50);
    applyProgressToTabElement(tab, 3, 0);
    const bar = tab.querySelector(".tab-progress") as HTMLElement;
    expect(bar.style.width).toBe("");
    expect(bar.classList.contains("state-indeterminate")).toBe(true);
  });

  it("hidden state removes the bar", () => {
    const tab = makeTab();
    applyProgressToTabElement(tab, 1, 50);
    applyProgressToTabElement(tab, 0, 0);
    expect(tab.querySelector(".tab-progress")).toBeNull();
  });

  it("hidden state on a fresh tab is a no-op", () => {
    const tab = makeTab();
    applyProgressToTabElement(tab, 0, 0);
    expect(tab.querySelector(".tab-progress")).toBeNull();
  });
});
