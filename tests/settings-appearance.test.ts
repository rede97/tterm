import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn((cmd: string) => {
    if (cmd === "read_config_file") return Promise.resolve("{}");
    if (cmd === "ssh_read_config_raw") return Promise.resolve("");
    if (cmd === "serial_list_ports") return Promise.resolve([]);
    return Promise.resolve(null);
  }),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: () => Promise.resolve("0.2.0") }));

import { configStore } from "../src/core/store";
import { createSettingsContent } from "../src/settings/index";

function openAppearance(): HTMLElement {
  const root = createSettingsContent();
  document.body.appendChild(root);
  root.querySelectorAll<HTMLElement>(".settings-nav-item").forEach((n) => {
    if (n.dataset.panel === "appearance") n.click();
  });
  return root;
}

function glassSwitch(root: HTMLElement): HTMLButtonElement {
  const row = [...root.querySelectorAll(".row")].find((el) =>
    el.querySelector(".row-title")?.textContent?.includes("Frosted overlays"),
  );
  const btn = row?.querySelector<HTMLButtonElement>(".tt-switch");
  expect(btn, "Frosted overlays switch").toBeTruthy();
  return btn!;
}

describe("settings — appearance chrome", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    invokeMock.mockClear();
    configStore.set({ chromeSkin: "cursor", overlayGlass: false });
  });

  it("Chrome Skin lives with Frosted overlays (not a Quick Panel section)", () => {
    const root = openAppearance();
    const appearance = root.querySelector('.settings-panel-content[data-panel="appearance"]')!;
    const titles = [...appearance.querySelectorAll(".section-title")].map((el) =>
      (el.textContent ?? "").replace(/\s+/g, " ").trim(),
    );
    expect(titles).toContain("Chrome Skin");
    expect(titles.some((t) => t.includes("Quick Panel"))).toBe(false);
    expect(root.querySelector('[aria-label="Chrome skin"] .skin-card')).toBeTruthy();
    expect(glassSwitch(root).getAttribute("aria-checked")).toBe("false");
  });

  it("picking a skin card writes chromeSkin immediately", () => {
    const root = openAppearance();
    const vscode = root.querySelector<HTMLElement>('.skin-card[data-skin="vscode"]');
    expect(vscode).toBeTruthy();
    vscode!.click();
    expect(configStore.get("chromeSkin")).toBe("vscode");
    expect(vscode!.classList.contains("selected")).toBe(true);
  });

  it("Frosted overlays writes overlayGlass immediately (no Apply gate)", () => {
    const root = openAppearance();
    expect(configStore.get("overlayGlass")).toBe(false);
    glassSwitch(root).click();
    expect(configStore.get("overlayGlass")).toBe(true);
    expect(glassSwitch(root).getAttribute("aria-checked")).toBe("true");
  });
});
