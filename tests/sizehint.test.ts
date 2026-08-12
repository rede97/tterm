import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SizeHint } from "../src/util/sizehint";

describe("SizeHint", () => {
  let parent: HTMLElement;

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = "";
    parent = document.createElement("div");
    document.body.appendChild(parent);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows cols × rows and becomes visible", () => {
    const hint = new SizeHint(parent);
    hint.show(120, 30);
    expect(hint.text).toBe("120 × 30");
    expect(hint.isVisible).toBe(true);
  });

  it("auto-hides after the delay", () => {
    const hint = new SizeHint(parent, 1000);
    hint.show(80, 24);
    vi.advanceTimersByTime(999);
    expect(hint.isVisible).toBe(true);
    vi.advanceTimersByTime(1);
    expect(hint.isVisible).toBe(false);
  });

  it("resets the hide timer on repeated shows", () => {
    const hint = new SizeHint(parent, 1000);
    hint.show(80, 24);
    vi.advanceTimersByTime(800);
    hint.show(100, 40); // re-arm
    vi.advanceTimersByTime(800);
    expect(hint.isVisible).toBe(true); // original 1000ms would have fired
    expect(hint.text).toBe("100 × 40");
    vi.advanceTimersByTime(200);
    expect(hint.isVisible).toBe(false);
  });

  it("destroy removes the element and cancels pending hide", () => {
    const hint = new SizeHint(parent);
    hint.show(80, 24);
    hint.destroy();
    expect(parent.querySelector(".size-hint")).toBeNull();
    expect(() => vi.advanceTimersByTime(5000)).not.toThrow();
  });
});
