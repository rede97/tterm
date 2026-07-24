import { describe, it, expect, vi, beforeEach } from "vitest";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn((cmd: string) => {
    if (cmd === "read_config") return Promise.resolve("{}");
    return Promise.resolve(null);
  }),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

import { configStore } from "../src/core/store";
import {
  serialKeyFor, serialParamsFor, rememberSerialParams, forgetSerialParams,
} from "../src/config/serial-memory";

const USB_PORT = { name: "COM3", vid: "1A86", pid: "7523" };
const COM_PORT = { name: "COM7", vid: "", pid: "" };

describe("serial per-port memory (keyed by VID:PID for USB)", () => {
  beforeEach(() => {
    invokeMock.mockClear();
    configStore.set({ serialPortParams: {} });
  });

  it("keys USB devices by vid:pid, others by port name", () => {
    expect(serialKeyFor(USB_PORT)).toBe("usb:1A86:7523");
    expect(serialKeyFor(COM_PORT)).toBe("com:COM7");
  });

  it("falls back to global defaults when no memory exists", () => {
    const p = serialParamsFor(USB_PORT);
    expect(p.baud).toBe(configStore.get("serialBaud"));
    expect(p.inputMode).toBe(configStore.get("serialInputMode"));
  });

  it("remembered params win and persist", async () => {
    vi.useFakeTimers();
    try {
      await rememberSerialParams(serialKeyFor(USB_PORT), { baud: 9600, inputMode: "line" });
      const p = serialParamsFor(USB_PORT);
      expect(p.baud).toBe(9600);
      expect(p.inputMode).toBe("line");
      // a different COM name with the same VID:PID still matches
      const moved = serialParamsFor({ name: "COM11", vid: "1A86", pid: "7523" });
      expect(moved.baud).toBe(9600);

      await vi.advanceTimersByTimeAsync(300);
      const write = invokeMock.mock.calls.find(c => c[0] === "write_config");
      const written = JSON.parse((write![1] as any).content);
      expect(written.serialPortParams["usb:1A86:7523"].baud).toBe(9600);
    } finally {
      vi.useRealTimers();
    }
  });

  it("partial updates merge with existing memory", async () => {
    await rememberSerialParams(serialKeyFor(USB_PORT), { baud: 9600, inputMode: "echo" });
    await rememberSerialParams(serialKeyFor(USB_PORT), { baud: 57600 });
    const p = serialParamsFor(USB_PORT);
    expect(p.baud).toBe(57600);
    expect(p.inputMode).toBe("echo"); // preserved
  });

  it("forget removes the record", async () => {
    await rememberSerialParams(serialKeyFor(USB_PORT), { baud: 9600 });
    await forgetSerialParams(serialKeyFor(USB_PORT));
    expect(configStore.get("serialPortParams")[serialKeyFor(USB_PORT)]).toBeUndefined();
    expect(serialParamsFor(USB_PORT).baud).toBe(configStore.get("serialBaud"));
  });
});
