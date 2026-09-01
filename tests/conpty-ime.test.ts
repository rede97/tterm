import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

import {
  type ConptyImeCaps,
  capsFreshForVersion,
  parseConptyImeCaps,
  refreshConptyImeCaps,
  serializeConptyImeCaps,
  setConptyImeCaps,
} from "../src/config/conpty-ime";

const sample: ConptyImeCaps = {
  appVersion: "3.0.0",
  win10: true,
  winBuild: 19045,
  cursorHideForwarded: false,
  probedAt: 1,
};

describe("conpty-ime.json", () => {
  it("round-trips a valid probe record", () => {
    const parsed = parseConptyImeCaps(serializeConptyImeCaps(sample));
    expect(parsed).toEqual(sample);
  });

  it("rejects junk", () => {
    expect(parseConptyImeCaps("{}")).toBeNull();
    expect(parseConptyImeCaps("[]")).toBeNull();
    expect(parseConptyImeCaps("not json")).toBeNull();
  });

  it("treats a record from another app version as stale", () => {
    expect(capsFreshForVersion(sample, "3.0.0")).toBe(true);
    expect(capsFreshForVersion(sample, "3.1.0")).toBe(false);
    expect(capsFreshForVersion(null, "3.0.0")).toBe(false);
  });
});

describe("refreshConptyImeCaps", () => {
  beforeEach(() => {
    setConptyImeCaps(null);
    invokeMock.mockReset();
  });

  it("re-probes and rewrites the file after an app update", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "read_config_file") {
        return Promise.resolve(serializeConptyImeCaps(sample));
      }
      if (cmd === "pty_probe_ime_caps") {
        return Promise.resolve({
          win10: true,
          winBuild: 19045,
          cursorHideForwarded: false,
        });
      }
      if (cmd === "write_config_file") return Promise.resolve();
      return Promise.resolve(null);
    });
    const caps = await refreshConptyImeCaps("3.1.0");
    expect(caps?.appVersion).toBe("3.1.0");
    expect(caps?.win10).toBe(true);
    expect(invokeMock.mock.calls.map((c) => c[0])).toContain("pty_probe_ime_caps");
    const write = invokeMock.mock.calls.find((c) => c[0] === "write_config_file");
    expect(write?.[1]).toMatchObject({ name: "conpty-ime" });
    expect(String(write?.[1]?.content)).toContain('"appVersion": "3.1.0"');
  });

  it("skips the ConPTY probe when the cached version matches", async () => {
    setConptyImeCaps(sample);
    const caps = await refreshConptyImeCaps("3.0.0");
    expect(caps).toEqual(sample);
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
