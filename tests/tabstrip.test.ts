import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { syncTabStripState } from "../src/terminal/tabmanager";

// jsdom has no layout: scroll metrics are stubbed per-element.
function strip(metrics: {
  clientWidth: number;
  scrollWidth: number;
  scrollLeft: number;
}): HTMLElement {
  const el = document.createElement("div");
  Object.defineProperty(el, "clientWidth", { value: metrics.clientWidth, configurable: true });
  Object.defineProperty(el, "scrollWidth", { value: metrics.scrollWidth, configurable: true });
  Object.defineProperty(el, "scrollLeft", {
    value: metrics.scrollLeft,
    configurable: true,
    writable: true,
  });
  return el;
}

function classes(el: HTMLElement): Record<string, boolean> {
  return {
    overflowing: el.classList.contains("overflowing"),
    left: el.classList.contains("can-scroll-left"),
    right: el.classList.contains("can-scroll-right"),
  };
}

describe("syncTabStripState — scroll-edge shadows", () => {
  it("roomy strip: nothing scrolls, no shadows", () => {
    const el = strip({ clientWidth: 800, scrollWidth: 400, scrollLeft: 0 });
    syncTabStripState(el);
    expect(classes(el)).toEqual({ overflowing: false, left: false, right: false });
  });

  it("scrolled to the start: only the right shadow shows", () => {
    const el = strip({ clientWidth: 400, scrollWidth: 900, scrollLeft: 0 });
    syncTabStripState(el);
    expect(classes(el)).toEqual({ overflowing: true, left: false, right: true });
  });

  it("mid-scroll: both edge shadows show", () => {
    const el = strip({ clientWidth: 400, scrollWidth: 900, scrollLeft: 250 });
    syncTabStripState(el);
    expect(classes(el)).toEqual({ overflowing: true, left: true, right: true });
  });

  it("scrolled to the end: only the left shadow shows", () => {
    const el = strip({ clientWidth: 400, scrollWidth: 900, scrollLeft: 500 });
    syncTabStripState(el);
    expect(classes(el)).toEqual({ overflowing: true, left: true, right: false });
  });

  it("shadows clear when the strip becomes roomy again", () => {
    const el = strip({ clientWidth: 400, scrollWidth: 900, scrollLeft: 250 });
    syncTabStripState(el);
    expect(classes(el).left).toBe(true);

    Object.defineProperty(el, "clientWidth", { value: 1000 });
    Object.defineProperty(el, "scrollLeft", { value: 0 });
    syncTabStripState(el);
    expect(classes(el)).toEqual({ overflowing: false, left: false, right: false });
  });
});

describe("tab share/dirty dots", () => {
  it("overlay the chrome so they cannot change tab width", () => {
    const css = readFileSync(join(__dirname, "../src/styles.css"), "utf8");
    const block = css.match(/\.tab\.shared::after,\s*\.tab\.dirty::after\s*\{[^}]+\}/);
    expect(block?.[0]).toContain("position: absolute");
    expect(block?.[0]).not.toContain("order:");
  });
});
