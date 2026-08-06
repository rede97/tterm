import { describe, it, expect, vi, beforeEach } from "vitest";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn(() => Promise.resolve(null)) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: () => Promise.resolve("0.10.0") }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

import { createGeneralPanel, collectGeneralSettings } from "../src/settings/general";
import { configStore } from "../src/core/store";

beforeEach(() => {
  document.body.innerHTML = "";
  configStore.set({ closeToTray: false });
});

describe("settings — close to tray", () => {
  it("renders the toggle reflecting config (default off)", () => {
    const panel = createGeneralPanel();
    const toggle = panel.querySelector<HTMLInputElement>("#set-close-to-tray");
    expect(toggle).toBeTruthy();
    expect(toggle!.checked).toBe(false);
  });

  it("renders checked when enabled", () => {
    configStore.set({ closeToTray: true });
    const panel = createGeneralPanel();
    expect(panel.querySelector<HTMLInputElement>("#set-close-to-tray")!.checked).toBe(true);
  });

  it("collect returns the toggled value", () => {
    const panel = createGeneralPanel();
    const toggle = panel.querySelector<HTMLInputElement>("#set-close-to-tray")!;
    toggle.checked = true;
    expect(collectGeneralSettings(panel).closeToTray).toBe(true);
    toggle.checked = false;
    expect(collectGeneralSettings(panel).closeToTray).toBe(false);
  });
});
