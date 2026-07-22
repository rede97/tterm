import { describe, it, expect, vi, beforeEach } from "vitest";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn((cmd: string) => {
    if (cmd === "read_config") return Promise.resolve("{}");
    return Promise.resolve(null);
  }),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

import {
  serialBaudFor, rememberSerialBaud, serialPortParams, configSerialBaud,
} from "../src/profiles";

describe("serial per-port baud memory", () => {
  beforeEach(() => {
    invokeMock.mockClear();
  });

  it("falls back to the global default when no memory exists", () => {
    expect(serialBaudFor("COM99")).toBe(configSerialBaud);
  });

  it("rememberSerialBaud updates the lookup and persists to config", async () => {
    await rememberSerialBaud("COM3", 9600);
    expect(serialBaudFor("COM3")).toBe(9600);
    // other ports still use the default
    expect(serialBaudFor("COM5")).toBe(configSerialBaud);

    const writeCall = invokeMock.mock.calls.find(c => c[0] === "write_config");
    expect(writeCall).toBeTruthy();
    const written = JSON.parse((writeCall![1] as any).content);
    expect(written.serialPortParams.COM3.baud).toBe(9600);
  });

  it("rememberSerialBaud overwrites previous memory for the same port", async () => {
    await rememberSerialBaud("COM3", 9600);
    await rememberSerialBaud("COM3", 57600);
    expect(serialBaudFor("COM3")).toBe(57600);
    expect(Object.keys(serialPortParams)).toEqual(["COM3"]);
  });
});
