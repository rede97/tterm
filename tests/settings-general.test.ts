import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve(null)),
}));
vi.mock("@tauri-apps/api/app", () => ({
  getVersion: vi.fn(() => Promise.resolve("9.9.9")),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
}));

import { configStore } from "../src/core/store";
import { collectGeneralSettings, createGeneralPanel } from "../src/settings/general";

beforeEach(() => {
  document.body.innerHTML = "";
  configStore.set({ imePinCorner: false, imeFakeCursorScan: true });
});

describe("settings — fixed input box", () => {
  it("starts off and Apply collects the toggle", () => {
    const panel = createGeneralPanel();
    document.body.appendChild(panel);
    const sw = panel.querySelector<HTMLButtonElement>("#set-ime-pin-corner");
    expect(sw?.getAttribute("aria-checked")).toBe("false");
    expect(panel.textContent).toContain("Fixed input box");
    sw?.click();
    expect(sw?.getAttribute("aria-checked")).toBe("true");
    expect(collectGeneralSettings(panel).imePinCorner).toBe(true);
  });
});
