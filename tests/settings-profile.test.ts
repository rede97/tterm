import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn((cmd: string) => {
    if (cmd === "read_config_file") return Promise.resolve("{}");
    if (cmd === "serial_list_ports") return Promise.resolve([]);
    if (cmd === "ssh_list_keys") return Promise.resolve([]);
    return Promise.resolve(null);
  }),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: () => Promise.resolve("1.0.1") }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

import { configStore } from "../src/core/store";
import { createSettingsContent } from "../src/settings/index";
import { refreshProfilePanel } from "../src/settings/profile";

const PROFILES = [
  { name: "PowerShell", command: "powershell.exe" },
  { name: "Ubuntu", command: "wsl.exe -d Ubuntu" },
];

beforeEach(() => {
  document.body.innerHTML = "";
  invokeMock.mockClear();
  configStore.set({
    localProfiles: PROFILES.map((p) => ({ ...p })),
    hiddenProfiles: [],
    defaultLocalProfile: "Ubuntu",
  });
});

function profileSelect(root: HTMLElement): HTMLSelectElement {
  const el = root.querySelector<HTMLSelectElement>("#set-default-profile");
  expect(el, "default-profile select").toBeTruthy();
  return el!;
}

describe("settings — profile panel", () => {
  it("default-profile select initializes to the configured profile, not the first", () => {
    const root = createSettingsContent();
    expect(profileSelect(root).value).toBe("Ubuntu");
  });

  it("Apply preserves the configured default profile", async () => {
    const root = createSettingsContent();
    document.body.appendChild(root);
    const applyBtn = root.querySelector<HTMLButtonElement>(
      ".settings-footer .settings-btn:not(.settings-btn-revert)",
    )!;
    applyBtn.click();
    await vi.waitFor(() => {
      expect(document.querySelector("#toast-container")?.textContent).toContain("Settings applied");
    });
    // Regression: an unrelated Apply used to rewrite defaultLocalProfile
    // to the first profile because the select was never initialized.
    expect(configStore.get("defaultLocalProfile")).toBe("Ubuntu");
  });

  it("refreshProfilePanel rebuilds the lists from the store (WT set changed)", () => {
    const root = createSettingsContent();
    expect(profileSelect(root).options).toHaveLength(2);

    configStore.set({
      localProfiles: [...PROFILES.map((p) => ({ ...p })), { name: "CMD", command: "cmd.exe" }],
      defaultLocalProfile: "CMD",
      hiddenProfiles: ["PowerShell"],
    });
    refreshProfilePanel(root);

    const sel = profileSelect(root);
    expect(sel.options).toHaveLength(3);
    expect(sel.value).toBe("CMD");
    const checks = root.querySelectorAll<HTMLElement>(".wt-profile-check");
    expect(checks).toHaveLength(3);
    const ps = [...checks].find((c) => c.getAttribute("value") === "PowerShell")!;
    expect(ps.getAttribute("aria-checked")).toBe("false");
    // Panel-scoped: the settings page chrome survives the re-render.
    expect(root.querySelectorAll(".settings-nav-item")).toHaveLength(6);
  });
});
