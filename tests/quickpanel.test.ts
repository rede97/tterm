import { describe, it, expect, vi, beforeEach } from "vitest";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: vi.fn(() => Promise.resolve()) }));

import {
  initQuickPanel,
  setQuickPanelHandlers,
  updateQuickButton,
  closeQuickPanel,
  type QuickPanelHandlers,
} from "../src/terminal/quickpanel";
import type { TerminalTab } from "../src/terminal/tab";

function fakeTab(over: Partial<TerminalTab> & { id: string }): TerminalTab {
  return {
    label: over.id,
    type: "local",
    shared: false,
    disconnected: false,
    sshEmbedded: false,
    enterNewline: "cr",
    ...over,
  } as unknown as TerminalTab;
}

let activeTab: TerminalTab | undefined;
const handlers = {
  getActiveTab: vi.fn(() => activeTab),
  getTab: vi.fn((id: string) => (activeTab?.id === id ? activeTab : undefined)),
  shareTab: vi.fn(() => Promise.resolve()),
  setSerialBaud: vi.fn(() => Promise.resolve()),
  setSerialProfile: vi.fn(() => Promise.resolve()),
  setSerialInputMode: vi.fn(),
  setSerialOutputNewline: vi.fn(() => Promise.resolve()),
  setSerialEnterNewline: vi.fn(() => Promise.resolve()),
} satisfies QuickPanelHandlers;

setQuickPanelHandlers(handlers);

function button(): HTMLButtonElement {
  return document.getElementById("quick-status") as HTMLButtonElement;
}

function panel(): HTMLElement {
  return document.querySelector(".quick-panel")!;
}

function openPanel(): HTMLElement {
  // togglePanel is fully synchronous (handlers are injected, no dynamic
  // import) — only the IPC state reads inside sections resolve async.
  button().click();
  return panel();
}

function switchOf(row: Element | null): HTMLElement {
  return row?.querySelector<HTMLElement>(".qp-switch")!;
}

beforeEach(() => {
  vi.clearAllMocks();
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === "session_get_auto_reconnect") return Promise.resolve(false);
    if (cmd === "serial_line_status") return Promise.resolve({ rts: true, cts: true, dtr: true, dsr: true, supported: true });
    if (cmd === "ssh_forward_list") return Promise.resolve([]);
    return Promise.resolve(null);
  });
  closeQuickPanel();
  document.body.innerHTML = `<button id="quick-status"></button>`;
  initQuickPanel();
  activeTab = undefined;
});

describe("quick-status button", () => {
  it("is disabled with no active tab and does not open", () => {
    updateQuickButton();
    expect(button().classList.contains("disabled")).toBe(true);
    expect(button().disabled).toBe(true);
    openPanel();
    expect(panel().classList.contains("open")).toBe(false);
  });

  it("is enabled with an active tab", () => {
    activeTab = fakeTab({ id: "tab-1" });
    updateQuickButton();
    expect(button().disabled).toBe(false);
    expect(button().classList.contains("disabled")).toBe(false);
  });

  it("shows a red dot while the active session is down", () => {
    activeTab = fakeTab({ id: "tab-1", disconnected: true });
    updateQuickButton();
    expect(button().dataset.state).toBe("down");
  });

  it("shows a blue dot while the active session is AI-shared", () => {
    activeTab = fakeTab({ id: "tab-1", shared: true, shareUrl: "http://127.0.0.1/s/x" });
    updateQuickButton();
    expect(button().dataset.state).toBe("shared");
  });
});

describe("quick panel — local tab", () => {
  it("shows only the AI Share section", async () => {
    activeTab = fakeTab({ id: "tab-1", label: "pwsh" });
    const p = openPanel();
    expect(p.classList.contains("open")).toBe(true);
    expect(p.querySelector('[data-section="share"]')).not.toBeNull();
    expect(p.querySelector('[data-section="ssh"]')).toBeNull();
    expect(p.querySelector('[data-section="serial"]')).toBeNull();
    expect(p.querySelector(".qp-title")!.textContent).toBe("pwsh");
    expect(p.querySelector(".qp-state-connected")).not.toBeNull();
  });

  it("share toggle calls shareTab and reveals the link row when shared", async () => {
    activeTab = fakeTab({ id: "tab-1" });
    const p = openPanel();
    const row = p.querySelector('[data-section="share"] .qp-toggle-row')!;
    switchOf(row).click();
    expect(handlers.shareTab).toHaveBeenCalledWith("tab-1");
  });

  it("renders share URL with a copy button while shared", async () => {
    activeTab = fakeTab({ id: "tab-1", shared: true, shareUrl: "http://127.0.0.1:9/s/abc" });
    const p = openPanel();
    expect(p.querySelector(".qp-share-url")!.textContent).toBe("http://127.0.0.1:9/s/abc");
    expect(p.querySelector(".qp-share-url-row .qp-mini-btn")!.textContent).toBe("Copy");
  });
});

describe("quick panel — serial tab", () => {
  beforeEach(() => {
    activeTab = fakeTab({ id: "tab-7", type: "serial", serialBaud: 115200, outputNewline: "keep", serialProfile: "Normal" });
  });

  // Rows are matched by their label span (select option text like
  // "Hardware (RTS/CTS)" would collide with a plain textContent search).
  function rowOf(sec: Element, label: string): HTMLElement | undefined {
    return [...sec.querySelectorAll<HTMLElement>(".qp-row")]
      .find((r) => r.querySelector(".qp-label")?.textContent === label);
  }

  it("shows the profile select with built-in profiles first", () => {
    const p = openPanel();
    const sec = p.querySelector('[data-section="serial"]')!;
    // Connection (manual release/reconnect) is the first row; Profile next.
    const firstRow = sec.querySelector<HTMLElement>(".qp-row")!;
    expect(firstRow.querySelector(".qp-label")!.textContent).toBe("Connection");
    const profileRow = rowOf(sec, "Profile")!;
    expect(profileRow).toBeDefined();
    const sel = profileRow.querySelector("select")!;
    expect(sel.value).toBe("Normal");
    const builtin = sel.querySelector('optgroup[label="Built-in"]')!;
    expect([...builtin.querySelectorAll("option")].map((o) => o.value)).toEqual(["Normal", "Log", "AT"]);
    expect(rowOf(sec, "Baud rate")).toBeDefined();
    expect(rowOf(sec, "Auto-reconnect")).toBeDefined();
    expect(rowOf(sec, "Input mode")).toBeDefined();
    expect(rowOf(sec, "Enter sends")).toBeDefined();
    expect(rowOf(sec, "Output newlines")).toBeDefined();
    expect(rowOf(sec, "Flow control")).toBeDefined();
  });

  it("selecting the AT profile calls setSerialProfile", () => {
    const p = openPanel();
    const sec = p.querySelector('[data-section="serial"]')!;
    const sel = rowOf(sec, "Profile")!.querySelector("select")!;
    sel.value = "AT";
    sel.dispatchEvent(new Event("change"));
    expect(handlers.setSerialProfile).toHaveBeenCalledWith("tab-7", "AT");
  });

  it("baud select change calls setSerialBaud with a number", async () => {
    const p = openPanel();
    const sec = p.querySelector('[data-section="serial"]')!;
    const sel = rowOf(sec, "Baud rate")!.querySelector("select")!;
    expect(sel.value).toBe("115200");
    sel.value = "9600";
    sel.dispatchEvent(new Event("change"));
    expect(handlers.setSerialBaud).toHaveBeenCalledWith("tab-7", 9600);
  });

  it("parameter selects call the live session-only handlers", () => {
    const p = openPanel();
    const sec = p.querySelector('[data-section="serial"]')!;
    const inputSel = rowOf(sec, "Input mode")!.querySelector("select")!;
    expect(inputSel.value).toBe("normal");
    inputSel.value = "echo";
    inputSel.dispatchEvent(new Event("change"));
    expect(handlers.setSerialInputMode).toHaveBeenCalledWith("tab-7", "echo");

    const enterSel = rowOf(sec, "Enter sends")!.querySelector("select")!;
    expect(enterSel.value).toBe("cr");
    enterSel.value = "crlf";
    enterSel.dispatchEvent(new Event("change"));
    expect(handlers.setSerialEnterNewline).toHaveBeenCalledWith("tab-7", "crlf");

    const outSel = rowOf(sec, "Output newlines")!.querySelector("select")!;
    expect(outSel.value).toBe("keep");
    outSel.value = "cr-in-lf";
    outSel.dispatchEvent(new Event("change"));
    expect(handlers.setSerialOutputNewline).toHaveBeenCalledWith("tab-7", "cr-in-lf");
  });

  it("Output newlines select shows a live help line and per-option tooltips", () => {
    const p = openPanel();
    const sec = p.querySelector('[data-section="serial"]')!;
    const outSel = rowOf(sec, "Output newlines")!.querySelector("select")!;
    const hint = sec.querySelector<HTMLElement>(".qp-select-hint")!;
    // Default keep: hint explains the current selection.
    expect(hint.textContent).toContain("Pass through unchanged");
    for (const opt of outSel.querySelectorAll("option")) {
      expect(opt.title.length).toBeGreaterThan(0);
    }
    // Switching updates the hint; the handler still fires.
    outSel.value = "force-crlf";
    outSel.dispatchEvent(new Event("change"));
    expect(hint.textContent).toContain("Normalize every ending");
    expect(handlers.setSerialOutputNewline).toHaveBeenCalledWith("tab-7", "force-crlf");
  });

  it("queries modem lines on open; auto-reconnect toggle works; no signal rows while flow is none", async () => {
    const p = openPanel();
    expect(invokeMock).toHaveBeenCalledWith("serial_line_status", { id: "tab-7" });
    const sec = p.querySelector('[data-section="serial"]')!;
    expect(rowOf(sec, "RTS")).toBeUndefined();
    expect(rowOf(sec, "DTR")).toBeUndefined();
    switchOf(rowOf(sec, "Auto-reconnect")!).click();
    expect(invokeMock).toHaveBeenCalledWith("session_set_auto_reconnect", { id: "tab-7", enabled: true });
  });

  it("flow control select calls serial_set_flow_control and reveals RTS/DTR/CTS/DSR rows", async () => {
    const p = openPanel();
    const sec = p.querySelector('[data-section="serial"]')!;
    const flowSel = rowOf(sec, "Flow control")!.querySelector("select")!;
    expect(flowSel.value).toBe("none");
    expect(flowSel.disabled).toBe(false);
    flowSel.value = "hardware";
    flowSel.dispatchEvent(new Event("change"));
    expect(invokeMock).toHaveBeenCalledWith("serial_set_flow_control", { id: "tab-7", flow: "hardware" });

    await vi.waitFor(() => {
      expect(rowOf(sec, "CTS")!.querySelector(".qp-line-val")!.textContent).toBe("asserted");
    });
    expect(rowOf(sec, "DSR")!.querySelector(".qp-line-val")!.textContent).toBe("asserted");

    // RTS/DTR toggles default from the queried line state (mock: on).
    switchOf(rowOf(sec, "RTS")!).click();
    expect(invokeMock).toHaveBeenCalledWith("serial_set_rts", { id: "tab-7", on: false });
    switchOf(rowOf(sec, "DTR")!).click();
    expect(invokeMock).toHaveBeenCalledWith("serial_set_dtr", { id: "tab-7", on: false });
  });

  it("greys out flow control when the port does not support modem lines", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "serial_line_status") return Promise.resolve({ rts: false, cts: false, dtr: false, dsr: false, supported: false });
      if (cmd === "session_get_auto_reconnect") return Promise.resolve(false);
      return Promise.resolve(null);
    });
    activeTab = fakeTab({ id: "tab-7", type: "serial", serialProfile: "Normal", flowControl: "hardware" });
    const p = openPanel();
    const sec = p.querySelector('[data-section="serial"]')!;
    const flowRow = rowOf(sec, "Flow control")!;
    await vi.waitFor(() => {
      expect(flowRow.querySelector("select")!.disabled).toBe(true);
    });
    expect(flowRow.classList.contains("qp-disabled")).toBe(true);
    expect(sec.textContent).toContain("not supported by this port");
    // No signal block even though the profile asks for hardware flow control.
    expect(rowOf(sec, "RTS")).toBeUndefined();
    expect(rowOf(sec, "DSR")).toBeUndefined();
  });

  it("greys out flow control when the line-status query fails", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "serial_line_status") return Promise.reject(new Error("io error"));
      if (cmd === "session_get_auto_reconnect") return Promise.resolve(false);
      return Promise.resolve(null);
    });
    const p = openPanel();
    const sec = p.querySelector('[data-section="serial"]')!;
    const flowRow = rowOf(sec, "Flow control")!;
    await vi.waitFor(() => {
      expect(flowRow.querySelector("select")!.disabled).toBe(true);
    });
    expect(flowRow.classList.contains("qp-disabled")).toBe(true);
  });
});

describe("quick panel — ssh tab", () => {
  it("embedded client shows port forwards and adds one inline", async () => {
    activeTab = fakeTab({ id: "tab-3", type: "ssh", sshEmbedded: true });
    const p = openPanel();
    const sec = p.querySelector('[data-section="ssh"]')!;
    expect(sec.textContent).toContain("Auto-reconnect");
    await vi.waitFor(() => {
      expect(sec.querySelector(".qp-fwd-empty")).not.toBeNull();
    });
    const ports = sec.querySelectorAll<HTMLInputElement>(".qp-fwd-port");
    ports[0].value = "8080";
    ports[1].value = "80";
    sec.querySelector<HTMLButtonElement>(".qp-fwd-add-btn")!.click();
    expect(invokeMock).toHaveBeenCalledWith("ssh_forward_add", {
      id: "tab-3",
      kind: "local",
      listenHost: "127.0.0.1",
      listenPort: 8080,
      targetHost: "127.0.0.1",
      targetPort: 80,
    });
  });

  it("external ssh hides the forwards block", async () => {
    activeTab = fakeTab({ id: "tab-4", type: "ssh", sshEmbedded: false });
    const p = openPanel();
    const sec = p.querySelector('[data-section="ssh"]')!;
    expect(sec.textContent).toContain("Auto-reconnect");
    expect(sec.querySelector(".qp-fwd")).toBeNull();
  });
});

describe("quick panel — dismissal", () => {
  it("closes on outside click and Escape", async () => {
    activeTab = fakeTab({ id: "tab-1" });
    const p = openPanel();
    expect(p.classList.contains("open")).toBe(true);
    document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(p.classList.contains("open")).toBe(false);

    openPanel();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(p.classList.contains("open")).toBe(false);
  });
});
