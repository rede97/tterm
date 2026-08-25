// Quick-panel serial controls are strictly session-only: switching the
// profile in the quick panel must apply live (input mode, Enter terminator,
// output newline) but NEVER touch flow control or the global default profile
// — defaults change only in Settings → Serial. A silent persistence there
// made every later tab inherit a profile the user only meant for one
// session.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn(() => Promise.resolve(null)) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

import { configStore } from "../src/core/store";
import { setSerialOutputNewline, setSerialProfile } from "../src/terminal/serialctl";
import type { TerminalTab } from "../src/terminal/tab";

function fakeSerialTab(): TerminalTab {
  return {
    id: "tab-1",
    type: "serial",
    serialProfile: "Normal",
    inputMode: "normal",
    enterNewline: "cr",
    outputNewline: "keep",
    flowControl: "none",
    setSerialInputMode(m: string) {
      this.inputMode = m;
    },
    setSerialEnterNewline(m: string) {
      this.enterNewline = m;
    },
  } as unknown as TerminalTab;
}

beforeEach(() => {
  invokeMock.mockClear();
  configStore.set({ serialProfile: "Normal" });
});

describe("quick-panel serial controls are session-only", () => {
  it("setSerialProfile applies the profile live", async () => {
    const tab = fakeSerialTab();
    await setSerialProfile(tab, "AT"); // builtin: line/crlf/cr-in-lf
    expect(tab.serialProfile).toBe("AT");
    expect(tab.inputMode).toBe("line");
    expect(tab.enterNewline).toBe("crlf");
    expect(tab.outputNewline).toBe("cr-in-lf");
    expect(invokeMock).toHaveBeenCalledWith("serial_set_output_newline", {
      id: "tab-1",
      mode: "cr-in-lf",
    });
    expect(invokeMock).not.toHaveBeenCalledWith("serial_set_flow_control", expect.anything());
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it("setSerialProfile does not change this session's flow control", async () => {
    const tab = fakeSerialTab();
    tab.flowControl = "hardware";
    await setSerialProfile(tab, "AT");
    expect(tab.flowControl).toBe("hardware");
    expect(invokeMock).not.toHaveBeenCalledWith("serial_set_flow_control", expect.anything());
  });

  it("setSerialProfile does NOT change the global default profile", async () => {
    await setSerialProfile(fakeSerialTab(), "Log");
    expect(configStore.get("serialProfile")).toBe("Normal");
  });

  it("setSerialOutputNewline does NOT change the global default profile", async () => {
    const tab = fakeSerialTab();
    await setSerialOutputNewline(tab, "cr-in-lf");
    expect(tab.outputNewline).toBe("cr-in-lf");
    expect(configStore.get("serialProfile")).toBe("Normal");
  });
});
