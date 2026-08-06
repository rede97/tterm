import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { showToast } from "../src/ui/toast";

describe("showToast", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = "";
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates a toast in a shared container with the right kind class", () => {
    const el = showToast("COM3 is busy", "error");
    expect(document.getElementById("toast-container")).toBeTruthy();
    expect(el.classList.contains("toast-error")).toBe(true);
    expect(el.textContent).toBe("COM3 is busy");
  });

  it("becomes visible on the next frame and auto-dismisses", () => {
    const el = showToast("hello", "info", 1000);
    vi.advanceTimersByTime(16); // rAF
    expect(el.classList.contains("visible")).toBe(true);
    vi.advanceTimersByTime(1000); // duration
    expect(el.classList.contains("visible")).toBe(false);
    vi.advanceTimersByTime(200); // removal transition
    expect(document.querySelector(".toast")).toBeNull();
  });

  it("clicking dismisses immediately", () => {
    const el = showToast("click me", "info", 60000);
    el.click();
    expect(el.classList.contains("visible")).toBe(false);
  });

  it("dismiss() removes a long-lived toast before its duration", () => {
    const el = showToast("Connecting…", "info", 60000);
    el.dismiss();
    expect(el.classList.contains("visible")).toBe(false);
    vi.advanceTimersByTime(200); // removal transition
    expect(document.querySelector(".toast")).toBeNull();
    // The pending duration timer must not fire later and disturb new toasts.
    const other = showToast("done", "info", 1000);
    vi.advanceTimersByTime(60000);
    expect(document.querySelector(".toast")).toBeNull();
    expect(other.isConnected).toBe(false);
  });

  it("stacks multiple toasts in one container", () => {
    showToast("a", "error");
    showToast("b", "info");
    expect(document.querySelectorAll("#toast-container .toast")).toHaveLength(2);
  });
});
