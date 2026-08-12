import { beforeEach, describe, expect, it } from "vitest";
import { createModal } from "../src/ui/modal";

function escapeKey() {
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
}

beforeEach(() => {
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
    m.overlay.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(m.overlay.isConnected).toBe(false);
    m.close();
    expect(closes).toBe(1);
  });

  it("a closed modal stops answering Escape (stack order heals)", () => {
    const first = createModal({ className: "m-a" });
    const second = createModal({ className: "m-b", singleton: false });
    document.body.append(first.overlay, second.overlay);
    second.close();
    escapeKey();
    expect(first.overlay.isConnected).toBe(false);
  });
});
