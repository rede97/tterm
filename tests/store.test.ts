import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn((cmd: string) => {
    if (cmd === "read_config") return Promise.resolve("{}");
    return Promise.resolve(null);
  }),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

import { configStore } from "../src/core/store";

describe("ConfigStore — set/get", () => {
  beforeEach(() => {
    invokeMock.mockClear();
    // Reset to defaults by setting each key
    configStore.set({
      fontSize: 14, fontFamily: "monospace", scrollback: 20000,
      themeName: "Default", renderer: "webgl", terminalBell: false,
      pasteWarning: true, pasteTrim: true, serialBaud: 115200,
      serialProfile: "Normal", defaultLocalProfile: null,
      hiddenProfiles: [], hiddenSshHosts: [],
    });
    configStore.flush();
    invokeMock.mockClear();
  });

  it("get returns default values", () => {
    expect(configStore.get("fontSize")).toBe(14);
    expect(configStore.get("serialBaud")).toBe(115200);
    expect(configStore.get("loaded")).toBe(false);
  });

  it("set updates state immediately", () => {
    configStore.set({ fontSize: 20 });
    expect(configStore.get("fontSize")).toBe(20);
  });

  it("set batch-updates multiple keys", () => {
    configStore.set({ fontSize: 18, scrollback: 5000, terminalBell: true });
    expect(configStore.get("fontSize")).toBe(18);
    expect(configStore.get("scrollback")).toBe(5000);
    expect(configStore.get("terminalBell")).toBe(true);
  });
});

describe("ConfigStore — subscribe", () => {
  beforeEach(() => {
    invokeMock.mockClear();
    configStore.set({ fontSize: 14 });
    configStore.flush();
    invokeMock.mockClear();
  });

  it("subscribe receives changed keys", () => {
    const fn = vi.fn();
    configStore.subscribe(fn);
    configStore.set({ fontSize: 16 });
    expect(fn).toHaveBeenCalledWith(["fontSize"]);
  });

  it("subscribe receives multiple changed keys", () => {
    const fn = vi.fn();
    configStore.subscribe(fn);
    configStore.set({ fontSize: 16, scrollback: 10000 });
    expect(fn).toHaveBeenCalledWith(expect.arrayContaining(["fontSize", "scrollback"]));
  });

  it("unsubscribe stops notifications", () => {
    const fn = vi.fn();
    const unsub = configStore.subscribe(fn);
    configStore.set({ fontSize: 16 });
    expect(fn).toHaveBeenCalledTimes(1);
    unsub();
    configStore.set({ fontSize: 18 });
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("ConfigStore — load", () => {
  beforeEach(() => {
    invokeMock.mockClear();
  });

  it("load reads config and applies values", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "read_config") return Promise.resolve(JSON.stringify({ fontSize: 20, themeName: "Nord" }));
      return Promise.resolve(null);
    });
    await configStore.load();
    expect(configStore.get("fontSize")).toBe(20);
    expect(configStore.get("themeName")).toBe("Nord");
    expect(configStore.get("loaded")).toBe(true);
  });

  it("load with empty config writes defaults to disk", async () => {
    // Reset state to defaults so snapshot reflects clean values
    configStore.set({ fontSize: 14, themeName: "Default", scrollback: 20000, serialBaud: 115200 });
    configStore.flush();
    invokeMock.mockClear();

    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "read_config") return Promise.resolve("{}");
      return Promise.resolve(null);
    });
    await configStore.load();
    expect(configStore.get("loaded")).toBe(true);
    // Should have written defaults
    const write = invokeMock.mock.calls.find(c => c[0] === "write_config");
    expect(write).toBeTruthy();
    const written = JSON.parse((write![1] as any).content);
    expect(written.fontSize).toBe(14);
    expect(written.serialBaud).toBe(115200);
  });

  it("load rejects invalid values", async () => {
    // Reset state to defaults
    configStore.set({ fontSize: 14, scrollback: 20000 });
    configStore.flush();
    invokeMock.mockClear();

    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "read_config") return Promise.resolve(JSON.stringify({ fontSize: 5, scrollback: 10 }));
      return Promise.resolve(null);
    });
    await configStore.load();
    // fontSize 5 is below minimum 10, should keep default
    expect(configStore.get("fontSize")).toBe(14);
    expect(configStore.get("scrollback")).toBe(20000);
  });
});

describe("ConfigStore — flush & debounce", () => {
  beforeEach(() => {
    invokeMock.mockClear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("set schedules a debounced save after 300ms", async () => {
    configStore.set({ fontSize: 20 });
    // No write yet
    expect(invokeMock.mock.calls.find(c => c[0] === "write_config")).toBeUndefined();
    await vi.advanceTimersByTimeAsync(300);
    const write = invokeMock.mock.calls.find(c => c[0] === "write_config");
    expect(write).toBeTruthy();
    expect(JSON.parse((write![1] as any).content).fontSize).toBe(20);
  });

  it("flush writes pending changes immediately", async () => {
    configStore.set({ fontSize: 22 });
    configStore.flush();
    // flush() calls _writeDisk which is async — flush microtasks
    await vi.advanceTimersByTimeAsync(0);
    const write = invokeMock.mock.calls.find(c => c[0] === "write_config");
    expect(write).toBeTruthy();
    expect(JSON.parse((write![1] as any).content).fontSize).toBe(22);
  });

  it("multiple sets merge into one debounced write", async () => {
    configStore.set({ fontSize: 20 });
    configStore.set({ scrollback: 5000 });
    await vi.advanceTimersByTimeAsync(300);
    const writes = invokeMock.mock.calls.filter(c => c[0] === "write_config");
    expect(writes).toHaveLength(1);
    const written = JSON.parse((writes[0][1] as any).content);
    expect(written.fontSize).toBe(20);
    expect(written.scrollback).toBe(5000);
  });

  it("runtime keys are not persisted", async () => {
    configStore.set({ sshHosts: [{ name: "test" }], serialPorts: [{ name: "COM1" }] });
    await vi.advanceTimersByTimeAsync(300);
    // Runtime-only keys don't trigger a disk save
    const write = invokeMock.mock.calls.find(c => c[0] === "write_config");
    expect(write).toBeUndefined();
  });
});
