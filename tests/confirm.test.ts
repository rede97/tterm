import { beforeEach, describe, expect, it } from "vitest";

import { confirmDialog } from "../src/ui/confirm";

function dialog(): HTMLElement {
  return document.querySelector(".confirm-overlay .cf-dialog")!;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("confirmDialog", () => {
  it("renders title, multi-line message, and custom button labels", () => {
    confirmDialog({
      title: "Update Available",
      message: "line one\n\nline two",
      okLabel: "Update",
      cancelLabel: "Later",
    });
    const d = dialog();
    expect(d.querySelector(".cf-header")!.textContent).toBe("Update Available");
    expect(d.querySelector(".confirm-text")!.textContent).toBe("line one\n\nline two");
    const btns = [...d.querySelectorAll<HTMLButtonElement>(".cf-btn")];
    expect(btns.map((b) => b.textContent)).toEqual(["Later", "Update"]);
  });

  it("resolves true on OK, false on Cancel", async () => {
    const p1 = confirmDialog({ title: "t", message: "m" });
    dialog().querySelector<HTMLButtonElement>(".cf-btn-ok")!.click();
    await expect(p1).resolves.toBe(true);
    expect(document.querySelector(".confirm-overlay")).toBeNull();

    const p2 = confirmDialog({ title: "t", message: "m" });
    dialog().querySelector<HTMLButtonElement>(".cf-cancel")!.click();
    await expect(p2).resolves.toBe(false);
    expect(document.querySelector(".confirm-overlay")).toBeNull();
  });

  it("resolves false on Escape and backdrop click (dismissal never confirms)", async () => {
    const p1 = confirmDialog({ title: "t", message: "m" });
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await expect(p1).resolves.toBe(false);

    const p2 = confirmDialog({ title: "t", message: "m" });
    const overlay = document.querySelector<HTMLElement>(".confirm-overlay")!;
    overlay.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await expect(p2).resolves.toBe(false);
  });

  it("danger style marks the dialog warn border and OK button", () => {
    confirmDialog({ title: "t", message: "m", danger: true });
    const d = dialog();
    expect(d.classList.contains("warn")).toBe(true);
    expect(d.querySelector(".cf-btn-danger")).not.toBeNull();
  });

  it("renders optional meta and mono preview blocks", () => {
    confirmDialog({ title: "t", message: "m", meta: "why not", preview: "a\nb" });
    const d = dialog();
    expect(d.querySelector(".cf-meta")!.textContent).toBe("why not");
    expect(d.querySelector(".cf-preview")!.textContent).toBe("a\nb");
    expect(d.querySelector(".cf-preview")!.classList.contains("tt-scroll")).toBe(true);
  });
});
