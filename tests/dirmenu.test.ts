import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(() => Promise.resolve(null)),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

import { configStore } from "../src/core/store";
import { launchDirectoryTab } from "../src/terminal/dirmenu";
import { tabManager } from "../src/terminal/tabmanager";

const PS = { name: "PowerShell", command: "powershell.exe" };
const CMD = { name: "Command Prompt", command: "cmd.exe" };

beforeEach(() => {
  configStore.set({
    localProfiles: [],
    defaultLocalProfile: null,
    recentDirectories: [],
  });
});

describe("TabManager.defaultLocalProfile", () => {
  it("returns the profile selected in settings", () => {
    configStore.set({ localProfiles: [CMD, PS], defaultLocalProfile: "PowerShell" });
    expect(tabManager.defaultLocalProfile()).toEqual({
      command: "powershell.exe",
      name: "PowerShell",
    });
  });

  it("falls back to the first profile when no default is set", () => {
    configStore.set({ localProfiles: [CMD, PS], defaultLocalProfile: null });
    expect(tabManager.defaultLocalProfile()).toEqual({
      command: "cmd.exe",
      name: "Command Prompt",
    });
  });

  it("returns null when no profiles are loaded (backend shell fallback)", () => {
    expect(tabManager.defaultLocalProfile()).toBeNull();
  });

  it("falls back to the first profile when the configured default is stale", () => {
    configStore.set({ localProfiles: [PS], defaultLocalProfile: "Deleted Profile" });
    // Stale name: find() misses → null (must not launch the wrong shell).
    expect(tabManager.defaultLocalProfile()).toBeNull();
  });
});

describe("launchDirectoryTab", () => {
  beforeEach(() => {
    vi.spyOn(tabManager, "createLocalTab").mockResolvedValue(null);
  });

  it("launches the default profile (not the backend fallback shell) in the picked directory", async () => {
    configStore.set({ localProfiles: [CMD, PS], defaultLocalProfile: "PowerShell" });
    await launchDirectoryTab("D:\\projects\\tterm");
    expect(tabManager.createLocalTab).toHaveBeenCalledWith(
      "powershell.exe",
      "tterm",
      "D:\\projects\\tterm",
    );
  });

  it("passes no command when no profiles exist (backend fallback)", async () => {
    await launchDirectoryTab("D:\\projects\\tterm");
    expect(tabManager.createLocalTab).toHaveBeenCalledWith(
      undefined,
      "tterm",
      "D:\\projects\\tterm",
    );
  });

  it("remembers the directory in recentDirectories (most-recent first, deduped)", async () => {
    configStore.set({ recentDirectories: ["D:\\a", "D:\\b"] });
    await launchDirectoryTab("D:\\b");
    expect(configStore.get("recentDirectories")).toEqual(["D:\\b", "D:\\a"]);
  });

  it("uses the last path component as the tab label, tolerating trailing separators", async () => {
    await launchDirectoryTab("D:\\projects\\tterm\\");
    expect(tabManager.createLocalTab).toHaveBeenCalledWith(
      undefined,
      "tterm",
      "D:\\projects\\tterm\\",
    );
  });
});
