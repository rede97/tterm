import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getCapsMock } = vi.hoisted(() => ({ getCapsMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.resolve("{}")) }));
vi.mock("../src/config/conpty-ime", () => ({
  getConptyImeCaps: getCapsMock,
}));

import { configStore } from "../src/core/store";
import { imeAnchorPolicy, setImeAnchorPolicyOverride } from "../src/util/imepolicy";

describe("imeAnchorPolicy", () => {
  beforeEach(() => {
    getCapsMock.mockReset();
    setImeAnchorPolicyOverride(null);
    configStore.set({ imeFakeCursorScan: true });
  });

  afterEach(() => {
    setImeAnchorPolicyOverride(null);
  });

  it("uses Win10-legacy scan when caps are not yet probed", () => {
    getCapsMock.mockReturnValue(null);
    expect(imeAnchorPolicy()).toEqual({ scanEnabled: true, scanWhenVisible: true });
  });

  it("uses Win10-legacy scan when hide is not forwarded", () => {
    getCapsMock.mockReturnValue({
      appVersion: "3.0.0",
      win10: true,
      winBuild: 19045,
      cursorHideForwarded: false,
      probedAt: 1,
    });
    expect(imeAnchorPolicy().scanWhenVisible).toBe(true);
  });

  it("does not scan while visible on Win11", () => {
    getCapsMock.mockReturnValue({
      appVersion: "3.0.0",
      win10: false,
      winBuild: 26100,
      cursorHideForwarded: true,
      probedAt: 1,
    });
    expect(imeAnchorPolicy()).toEqual({ scanEnabled: true, scanWhenVisible: false });
  });

  it("honours the Settings toggle", () => {
    getCapsMock.mockReturnValue({
      appVersion: "3.0.0",
      win10: true,
      winBuild: 19045,
      cursorHideForwarded: false,
      probedAt: 1,
    });
    configStore.set({ imeFakeCursorScan: false });
    expect(imeAnchorPolicy()).toEqual({ scanEnabled: false, scanWhenVisible: false });
  });
});
