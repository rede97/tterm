// Share control plane (/state + /control frontend half): action mapping,
// validation, and error surfacing. Agents must learn about bad values
// immediately — silent no-ops would poison every downstream assumption.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn(() => Promise.resolve(null)) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

import { applyShareControl, buildShareState } from "../src/terminal/sharecontrol";
import type { TerminalTab } from "../src/terminal/tab";

function fakeSerialTab(type = "serial"): TerminalTab {
  return {
    id: "tab-1",
    type,
    label: "COM25 · 115200",
    disconnected: false,
    serialPortName: "COM25",
    serialBaud: 115200,
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
    rename: vi.fn(),
  } as unknown as TerminalTab;
}

beforeEach(() => {
  invokeMock.mockClear();
});

describe("share /state", () => {
  it("reports serial session config", async () => {
    const st = await buildShareState(fakeSerialTab());
    expect(st.type).toBe("serial");
    expect(st.alive).toBe(true);
    expect(st.serial).toMatchObject({
      port: "COM25",
      baud: 115200,
      profile: "Normal",
      inputMode: "normal",
      outputNewline: "keep",
    });
    expect(st.forwards).toBeUndefined();
  });
});

describe("share /control serial", () => {
  it("applies output newline through the same path as the quick panel", async () => {
    const tab = fakeSerialTab();
    const r = await applyShareControl(tab, { serial: { outputNewline: "cr-in-lf" } });
    expect(r.ok).toBe(true);
    expect(invokeMock).toHaveBeenCalledWith("serial_set_output_newline", {
      id: "tab-1",
      mode: "cr-in-lf",
    });
    expect(tab.outputNewline).toBe("cr-in-lf");
  });

  it("rejects invalid values instead of ignoring them", async () => {
    const tab = fakeSerialTab();
    const r = await applyShareControl(tab, { serial: { outputNewline: "crlf-pls" } });
    expect(r.error).toContain("invalid outputNewline");
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("rejects serial actions on non-serial sessions", async () => {
    const r = await applyShareControl(fakeSerialTab("local"), { serial: { baud: 9600 } });
    expect(r.error).toBe("not a serial session");
  });

  it("drives modem lines only on explicit request", async () => {
    const tab = fakeSerialTab();
    const r = await applyShareControl(tab, { serial: { dtr: true } });
    expect(r.ok).toBe(true);
    expect(invokeMock).toHaveBeenCalledWith("serial_set_dtr", { id: "tab-1", on: true });
  });
});

describe("share /control forward", () => {
  function sshTab(embedded = true): TerminalTab {
    return {
      id: "tab-9",
      type: "ssh",
      label: "prod",
      disconnected: false,
      sshEmbedded: embedded,
    } as unknown as TerminalTab;
  }

  it("adds a forward and returns its backend id", async () => {
    invokeMock.mockImplementation((cmd: string) =>
      cmd === "ssh_forward_add" ? Promise.resolve(7) : Promise.resolve(null),
    );
    const r = await applyShareControl(sshTab(), {
      forward: {
        action: "add",
        kind: "local",
        listenPort: 8080,
        targetHost: "db",
        targetPort: 5432,
      },
    });
    expect(r.ok).toBe(true);
    expect(r.forwardId).toBe(7);
    expect(invokeMock).toHaveBeenCalledWith("ssh_forward_add", {
      id: "tab-9",
      kind: "local",
      listenHost: "127.0.0.1",
      listenPort: 8080,
      targetHost: "db",
      targetPort: 5432,
    });
  });

  it("removes a forward by id", async () => {
    const r = await applyShareControl(sshTab(), { forward: { action: "remove", forwardId: 7 } });
    expect(r.ok).toBe(true);
    expect(invokeMock).toHaveBeenCalledWith("ssh_forward_remove", { id: "tab-9", forwardId: 7 });
  });

  it("rejects forwards on non-embedded sessions", async () => {
    const r = await applyShareControl(sshTab(false), {
      forward: { action: "add", kind: "local", listenPort: 8080 },
    });
    expect(r.error).toContain("embedded");
  });

  it("rejects empty actions", async () => {
    expect((await applyShareControl(fakeSerialTab(), {})).error).toBe("nothing to apply");
  });
});
