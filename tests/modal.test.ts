import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "../src/ui/lit";
import { createModal, resetModalsForTests } from "../src/ui/modal";
import { ttSelect } from "../src/ui/select";
import { resetTerminalFocusForTests, setTerminalFocusRestore } from "../src/ui/termfocus";

function escapeKey() {
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
}

function nextFrame(): Promise<void> {
  return new Promise((r) => requestAnimationFrame(() => r()));
}

beforeEach(() => {
  resetTerminalFocusForTests();
  resetModalsForTests();
  document.body.innerHTML = "";
});

describe("createModal", () => {
  it("Escape closes only the topmost modal", () => {
    const first = createModal({ className: "m-one" });
    const second = createModal({ className: "m-two", singleton: false });
    document.body.append(first.overlay, second.overlay);

    escapeKey();
    expect(first.overlay.isConnected).toBe(true);
    expect(second.overlay.isConnected).toBe(false);

    escapeKey();
    expect(first.overlay.isConnected).toBe(false);
  });

  it("singleton modals replace the previous instance of their class", () => {
    const first = createModal({ className: "m-same" });
    document.body.appendChild(first.overlay);
    const second = createModal({ className: "m-same" });
    document.body.appendChild(second.overlay);
    expect(first.overlay.isConnected).toBe(false);
    expect(second.overlay.isConnected).toBe(true);
  });

  it("backdrop click closes the modal and runs onClose exactly once", () => {
    let closes = 0;
    const m = createModal({ className: "m-backdrop", onClose: () => closes++ });
    document.body.appendChild(m.overlay);
    m.overlay.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    m.overlay.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(m.overlay.isConnected).toBe(false);
    m.close();
    expect(closes).toBe(1);
  });

  it("releasing a drag from inside the dialog onto the dimmer does not close", () => {
    const m = createModal({ className: "m-drag" });
    const inner = document.createElement("div");
    m.overlay.appendChild(inner);
    document.body.appendChild(m.overlay);
    inner.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    m.overlay.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(m.overlay.isConnected).toBe(true);
    m.close();
  });

  it("a closed modal stops answering Escape (stack order heals)", () => {
    const first = createModal({ className: "m-a" });
    const second = createModal({ className: "m-b", singleton: false });
    document.body.append(first.overlay, second.overlay);
    second.close();
    escapeKey();
    expect(first.overlay.isConnected).toBe(false);
  });

  it("closing the modal tears down a portaled select menu (no orphan)", () => {
    const m = createModal({ className: "sp-overlay" });
    document.body.appendChild(m.overlay);
    const slot = document.createElement("div");
    m.overlay.appendChild(slot);
    render(
      ttSelect(
        "Input mode",
        [
          ["normal", "Normal"],
          ["line", "Line"],
        ],
        "normal",
        vi.fn(),
      ),
      slot,
    );
    const root = slot.querySelector<HTMLElement>(".tt-select")!;
    root.querySelector<HTMLElement>(".tt-select-trigger")!.click();
    expect(document.querySelector("body > .tt-select-menu.open")).toBeTruthy();

    m.close();
    expect(m.overlay.isConnected).toBe(false);
    expect(document.querySelector("body > .tt-select-menu.open")).toBeNull();
    expect(document.querySelector("body > .tt-select-menu")).toBeNull();
  });

  it("restores terminal focus only after the last modal closes", async () => {
    const restore = vi.fn();
    setTerminalFocusRestore(restore);

    const first = createModal({ className: "m-one" });
    const second = createModal({ className: "m-two", singleton: false });
    document.body.append(first.overlay, second.overlay);

    second.close();
    await nextFrame();
    expect(restore).not.toHaveBeenCalled();

    first.close();
    await nextFrame();
    expect(restore).toHaveBeenCalledTimes(1);
  });
});
