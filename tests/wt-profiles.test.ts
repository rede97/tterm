import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn((cmd: string) => {
    if (cmd === "read_config") return Promise.resolve("{}");
    return Promise.resolve(null);
  }),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

import { loadAllWtData, loadSerialPorts } from "../src/config/wt-profiles";

const WT_SETTINGS = JSON.stringify({
  profiles: {
    list: [
      { name: "PowerShell", commandline: "pwsh.exe" },
      { name: "Command Prompt", commandline: "cmd.exe" },
      { name: "Hidden Profile", commandline: "echo hi", hidden: true },
      { name: "WSL Ubuntu", source: "Windows.Terminal.Wsl" },
    ],
  },
  schemes: [],
});

describe("loadAllWtData", () => {
  beforeEach(() => {
    invokeMock.mockClear();
  });

  it("parses visible profiles from WT settings", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "read_wt_settings") return Promise.resolve(WT_SETTINGS);
      if (cmd === "read_wt_fragments") return Promise.resolve([]);
      if (cmd === "find_vs_instances") return Promise.resolve([]);
      return Promise.resolve(null);
    });
    const result = await loadAllWtData();
    expect(result.profiles).toHaveLength(3);
    const names = result.profiles.map((p) => p.name);
    expect(names).toContain("PowerShell");
    expect(names).toContain("Command Prompt");
    expect(names).toContain("WSL Ubuntu");
    expect(names).not.toContain("Hidden Profile");
  });

  it("extracts commandline when present", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "read_wt_settings") return Promise.resolve(WT_SETTINGS);
      if (cmd === "read_wt_fragments") return Promise.resolve([]);
      if (cmd === "find_vs_instances") return Promise.resolve([]);
      return Promise.resolve(null);
    });
    const result = await loadAllWtData();
    const ps = result.profiles.find((p) => p.name === "PowerShell")!;
    expect(ps.command).toBe("pwsh.exe");
  });

  it("infers command for WSL profiles from source", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "read_wt_settings") return Promise.resolve(WT_SETTINGS);
      if (cmd === "read_wt_fragments") return Promise.resolve([]);
      if (cmd === "find_vs_instances") return Promise.resolve([]);
      return Promise.resolve(null);
    });
    const result = await loadAllWtData();
    const wsl = result.profiles.find((p) => p.name === "WSL Ubuntu")!;
    expect(wsl.command).toContain("wsl.exe");
  });

  it("skips hidden profiles", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "read_wt_settings") return Promise.resolve(WT_SETTINGS);
      if (cmd === "read_wt_fragments") return Promise.resolve([]);
      if (cmd === "find_vs_instances") return Promise.resolve([]);
      return Promise.resolve(null);
    });
    const result = await loadAllWtData();
    expect(result.profiles.find((p) => p.name === "Hidden Profile")).toBeUndefined();
  });

  it("merges profiles from fragments", async () => {
    const fragment = JSON.stringify({
      profiles: {
        list: [{ name: "Git Bash", commandline: '"C:\\Program Files\\Git\\bin\\bash.exe"' }],
      },
    });
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "read_wt_settings") return Promise.resolve(WT_SETTINGS);
      if (cmd === "read_wt_fragments") return Promise.resolve([fragment]);
      if (cmd === "find_vs_instances") return Promise.resolve([]);
      return Promise.resolve(null);
    });
    const result = await loadAllWtData();
    expect(result.profiles.some((p) => p.name === "Git Bash")).toBe(true);
  });

  it("deduplicates profiles with the same name", async () => {
    const fragment = JSON.stringify({
      profiles: {
        list: [{ name: "PowerShell", commandline: "pwsh.exe" }],
      },
    });
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "read_wt_settings") return Promise.resolve(WT_SETTINGS);
      if (cmd === "read_wt_fragments") return Promise.resolve([fragment]);
      if (cmd === "find_vs_instances") return Promise.resolve([]);
      return Promise.resolve(null);
    });
    const result = await loadAllWtData();
    const ps = result.profiles.filter((p) => p.name === "PowerShell");
    expect(ps).toHaveLength(1);
  });

  it("handles null WT settings gracefully", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "read_wt_settings") return Promise.resolve(null);
      if (cmd === "read_wt_fragments") return Promise.resolve([]);
      if (cmd === "find_vs_instances") return Promise.resolve([]);
      return Promise.resolve(null);
    });
    const result = await loadAllWtData();
    expect(result.profiles).toEqual([]);
    expect(result.themes).toEqual([]);
  });

  it("returns VS installations", async () => {
    const vsInstalls = [
      {
        path: "C:\\Program Files\\Microsoft Visual Studio\\2022",
        version: "17.0",
        instance_id: "123",
      },
    ];
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "read_wt_settings") return Promise.resolve(null);
      if (cmd === "read_wt_fragments") return Promise.resolve([]);
      if (cmd === "find_vs_instances") return Promise.resolve(vsInstalls);
      return Promise.resolve(null);
    });
    const result = await loadAllWtData();
    expect(result.vsInstalls).toEqual(vsInstalls);
  });
});

describe("loadSerialPorts", () => {
  beforeEach(() => {
    invokeMock.mockClear();
  });

  it("returns serial ports from IPC", async () => {
    const ports = [
      {
        name: "COM3",
        driver: "usbser",
        manufacturer: "wch.cn",
        product: "CH340",
        vid: "1A86",
        pid: "7523",
      },
    ];
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "serial_list_ports") return Promise.resolve(ports);
      return Promise.resolve(null);
    });
    const result = await loadSerialPorts();
    expect(result).toEqual(ports);
  });

  it("returns empty array on error", async () => {
    invokeMock.mockImplementation(() => Promise.reject(new Error("IPC error")));
    const result = await loadSerialPorts();
    expect(result).toEqual([]);
  });
});
