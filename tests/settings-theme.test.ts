import { describe, it, expect, vi, beforeEach } from "vitest";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn((cmd: string) => {
    if (cmd === "read_config") return Promise.resolve("{}");
    if (cmd === "ssh_read_config_raw") return Promise.resolve("");
    if (cmd === "serial_list_ports") return Promise.resolve([]);
    return Promise.resolve(null);
  }),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: () => Promise.resolve("0.2.0") }));

import { createSettingsContent } from "../src/settings";
import { BUILTIN_THEMES } from "../src/themes";
import { configFontFamily, configThemeName } from "../src/profiles";

describe("settings — theme gallery", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    invokeMock.mockClear();
  });

  it("renders one card per theme with terminal-font preview", () => {
    const root = createSettingsContent();
    const cards = root.querySelectorAll(".theme-card");
    expect(cards.length).toBeGreaterThanOrEqual(BUILTIN_THEMES.length);

    const first = cards[0] as HTMLElement;
    const preview = first.querySelector(".theme-card-preview") as HTMLElement;
    // preview uses the real terminal font stack, not generic monospace
    // (happy-dom normalizes quote styles, so compare quote-insensitively)
    expect(preview.style.fontFamily.replace(/["']/g, ""))
      .toBe(configFontFamily.replace(/["']/g, ""));
    expect(first.querySelectorAll(".theme-card-swatch")).toHaveLength(16);
  });

  it("marks the configured theme as selected", () => {
    const root = createSettingsContent();
    const selected = root.querySelectorAll(".theme-card.selected");
    expect(selected).toHaveLength(1);
    expect((selected[0] as HTMLElement).dataset.theme).toBe(configThemeName);
  });

  it("clicking a card updates selection and pending themeName", () => {
    const root = createSettingsContent();
    const target = [...root.querySelectorAll<HTMLElement>(".theme-card")]
      .find(c => c.dataset.theme === "Dracula")!;
    target.click();
    expect(root.dataset.themeName).toBe("Dracula");
    expect(root.querySelectorAll(".theme-card.selected")).toHaveLength(1);
    expect((root.querySelector(".theme-card.selected") as HTMLElement).dataset.theme).toBe("Dracula");
  });

  it("apply persists the clicked theme via themeName", async () => {
    const root = createSettingsContent();
    document.body.appendChild(root);
    [...root.querySelectorAll<HTMLElement>(".theme-card")]
      .find(c => c.dataset.theme === "Nord")!.click();
    const applyBtn = [...root.querySelectorAll<HTMLButtonElement>(".settings-btn")]
      .find(b => b.textContent === "Apply")!;
    applyBtn.click();
    await vi.waitFor(() => {
      const write = invokeMock.mock.calls.find(c => c[0] === "write_config");
      expect(write).toBeTruthy();
      expect(JSON.parse((write![1] as any).content).themeName).toBe("Nord");
    });
  });
});
