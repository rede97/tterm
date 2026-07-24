import { describe, it, expect, beforeEach } from "vitest";
import { DisconnectOverlay } from "../src/util/disconnect";

describe("DisconnectOverlay", () => {
  let parent: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    parent = document.createElement("div");
    document.body.appendChild(parent);
  });

  it("starts hidden with reconnect hint text", () => {
    const ov = new DisconnectOverlay(parent);
    expect(ov.isVisible).toBe(false);
    expect(parent.textContent).toContain("disconnected");
    expect(parent.textContent).toContain("Enter to reconnect");
  });

  it("show/hide toggles visibility", () => {
    const ov = new DisconnectOverlay(parent);
    ov.show();
    expect(ov.isVisible).toBe(true);
    ov.hide();
    expect(ov.isVisible).toBe(false);
  });

  it("destroy removes the element", () => {
    const ov = new DisconnectOverlay(parent);
    ov.destroy();
    expect(parent.querySelector(".disconnect-overlay")).toBeNull();
  });
});
