import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock, checkMock } = vi.hoisted(() => ({
  invokeMock: vi.fn((cmd: string) => {
    if (cmd === "read_config_file") return Promise.resolve("{}");
    if (cmd === "serial_list_ports") return Promise.resolve([]);
    return Promise.resolve(null);
  }),
  checkMock: vi.fn(() => Promise.resolve(null)),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: () => Promise.resolve("0.7.3") }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: checkMock }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

import { configStore } from "../src/core/store";
import { scheduleAutoUpdateCheck } from "../src/core/updater";
import { createSettingsContent } from "../src/settings/index";

function generalPanel(root: HTMLElement): HTMLElement {
  const el = root.querySelector<HTMLElement>('.settings-panel-content[data-panel="general"]');
  expect(el, "general panel").toBeTruthy();
  return el!;
}

function autoUpdateToggle(root: HTMLElement): HTMLElement {
  const el = generalPanel(root).querySelector<HTMLElement>("#set-auto-update");
  expect(el, "auto-update toggle").toBeTruthy();
  return el!;
}

function toggleOn(el: HTMLElement): boolean {
  return el.getAttribute("aria-checked") === "true";
}

beforeEach(() => {
  document.body.innerHTML = "";
  invokeMock.mockClear();
  checkMock.mockClear();
  configStore.set({ autoCheckUpdates: true });
});

describe("settings — updates", () => {
  it("renders the Updates section with the toggle reflecting config (default on)", () => {
    const root = createSettingsContent();
    expect(toggleOn(autoUpdateToggle(root))).toBe(true);
  });

  it("renders the toggle unchecked when auto-check is disabled", () => {
    configStore.set({ autoCheckUpdates: false });
    const root = createSettingsContent();
    expect(toggleOn(autoUpdateToggle(root))).toBe(false);
  });

  it("apply persists autoCheckUpdates=false to the config file", async () => {
    const root = createSettingsContent();
    document.body.appendChild(root);
    autoUpdateToggle(root).click(); // flip off
    const applyBtn = [...root.querySelectorAll<HTMLButtonElement>(".tt-btn-primary")].find(
      (b) => b.textContent === "Apply",
    )!;
    applyBtn.click();
    await vi.waitFor(() => {
      const write = invokeMock.mock.calls.find((c) => c[0] === "write_config_file");
      expect(write).toBeTruthy();
      expect(JSON.parse((write![1] as any).content).autoCheckUpdates).toBe(false);
    });
    expect(configStore.get("autoCheckUpdates")).toBe(false);
  });

  it('"Check for Updates" button triggers a manual check', async () => {
    const root = createSettingsContent();
    document.body.appendChild(root);
    const btn = generalPanel(root).querySelector<HTMLButtonElement>("#set-check-update")!;
    expect(btn).toBeTruthy();
    btn.click();
    await vi.waitFor(() => expect(checkMock).toHaveBeenCalledTimes(1));
  });
});

describe("scheduleAutoUpdateCheck", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Tests exercise production behavior; vitest itself runs with DEV=true.
    vi.stubEnv("DEV", false);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("checks for updates after the delay when enabled", async () => {
    configStore.set({ autoCheckUpdates: true });
    scheduleAutoUpdateCheck(1000);
    expect(checkMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(checkMock).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the user disabled update checks", async () => {
    configStore.set({ autoCheckUpdates: false });
    scheduleAutoUpdateCheck(1000);
    await vi.advanceTimersByTimeAsync(60000);
    expect(checkMock).not.toHaveBeenCalled();
  });

  it("never schedules a check in dev builds, even when enabled", async () => {
    vi.stubEnv("DEV", true);
    configStore.set({ autoCheckUpdates: true });
    scheduleAutoUpdateCheck(1000);
    await vi.advanceTimersByTimeAsync(60000);
    expect(checkMock).not.toHaveBeenCalled();
  });
});
