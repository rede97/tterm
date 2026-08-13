// Opening a serial tab must apply the WHOLE default profile, not just copy
// fields onto the tab:
//   - outputNewline goes to the backend in serial_spawn — the Rust newline
//     converter only changes via serial_set_output_newline, so omitting it
//     at spawn leaves "keep" live until the user switches manually.
//   - inputMode/enterNewline must RE-HOOK the input handler (setters), not
//     just assign fields: the handler is hooked in the TerminalTab
//     constructor and captures mode + terminator by value, so plain
//     assignment leaves the Normal defaults live (audit: AT profile opened
//     with echo off and Enter sending CR instead of CRLF).
import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }));

const sockets: FakeSocket[] = [];
class FakeSocket {
  static OPEN = 1;
  readyState = 0;
  sent: string[] = [];
  listeners = new Map<string, ((e?: unknown) => void)[]>();
  constructor(public url: string) {
    sockets.push(this);
  }
  send(d: string) {
    this.sent.push(d);
  }
  close() {
    this.readyState = 3;
  }
  addEventListener(type: string, fn: (e?: unknown) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  fire(type: string, e?: unknown) {
    for (const fn of this.listeners.get(type) ?? []) fn(e);
  }
}
vi.stubGlobal("WebSocket", FakeSocket);

import { configStore } from "../src/core/store";
import type { SerialPort } from "../src/core/types";
import { TerminalTab } from "../src/terminal/tab";
import { TabManager } from "../src/terminal/tabmanager";

// Layout is meaningless in happy-dom (zero-size containers → non-integer
// grid); fit is deferred via timer and would throw after the test ends.
vi.spyOn(TerminalTab.prototype, "fitDeferred").mockImplementation(() => {});

function makeManager(): TabManager {
  const tabsEl = document.createElement("div");
  const termEl = document.createElement("div");
  document.body.append(tabsEl, termEl);
  return new TabManager(tabsEl, termEl);
}

const PORT = { name: "COM25" } as SerialPort;

beforeEach(() => {
  document.body.innerHTML = "";
  sockets.length = 0;
  invokeMock.mockReset();
  invokeMock.mockImplementation((cmd: string) =>
    cmd === "serial_spawn"
      ? Promise.resolve({ id: "tab-1", port: 4321, token: "tok" })
      : Promise.resolve(null),
  );
  configStore.set({ serialProfile: "Normal", serialBaud: 115200, renderer: "dom" });
  // happy-dom has no FontFaceSet; _ensureFontsReady only awaits .ready.
  Object.defineProperty(document, "fonts", {
    value: { ready: Promise.resolve() },
    configurable: true,
  });
});

describe("createSerialTab applies the default profile", () => {
  it("passes the profile's outputNewline to serial_spawn", async () => {
    configStore.set({ serialProfile: "Log" }); // builtin: out cr-in-lf
    const mgr = makeManager();
    const tab = await mgr.createSerialTab(PORT);
    expect(tab).not.toBeNull();

    const spawn = invokeMock.mock.calls.find((c) => c[0] === "serial_spawn");
    expect(spawn).toBeDefined();
    expect(spawn![1]).toMatchObject({
      portName: "COM25",
      outputNewline: "cr-in-lf",
      flowControl: "none",
    });
    expect(tab!.outputNewline).toBe("cr-in-lf");
  });

  it("re-hooks the input handler with the profile's mode and terminator", async () => {
    configStore.set({ serialProfile: "AT" }); // builtin: line mode + Enter CRLF
    const mgr = makeManager();
    const tab = await mgr.createSerialTab(PORT);
    expect(tab).not.toBeNull();

    const sock = sockets[0];
    sock.readyState = 1;
    sock.fire("open");
    // paste() routes through xterm's onData — the same path as keystrokes.
    tab!.terminal.paste("AT\r");

    // crlf terminator: the \r must go out as \r\n (plain field assignment
    // would leave the constructor-hooked "cr" default live → "AT\r").
    expect(sock.sent.join("")).toBe("AT\r\n");
    // line mode: input echoes locally (via terminal.write — async) even
    // though the device sent nothing.
    await vi.waitFor(() => {
      expect(tab!.terminal.buffer.active.getLine(0)?.translateToString(true)).toContain("AT");
    });
  });
});
