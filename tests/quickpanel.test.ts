import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  writeText: vi.fn(() => Promise.resolve()),
}));

import {
  closeQuickPanel,
  initQuickPanel,
  type QuickPanelHandlers,
  setQuickPanelHandlers,
  updateQuickButton,
} from "../src/terminal/quickpanel";
import type { TerminalTab } from "../src/terminal/tab";
import { assertModemHardware, assertModemUnsupported } from "./ui-contracts/qp-modem";

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
  setSerialFrame: vi.fn(() => Promise.resolve()),
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
  if (!row) throw new Error("switch row missing");
  const sw = row.querySelector<HTMLElement>(".tt-switch");
  if (!sw) throw new Error(".tt-switch missing in row");
  return sw;
}

beforeEach(() => {
  vi.clearAllMocks();
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === "session_get_auto_reconnect") return Promise.resolve(false);
    if (cmd === "serial_line_status")
      return Promise.resolve({ rts: true, cts: true, dtr: true, dsr: true, supported: true });
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

  it("accessible name tracks the session state (P1-03)", () => {
    updateQuickButton();
    expect(button().getAttribute("aria-label")).toBe("Session quick actions, no active session");
    expect(button().title).toBe("Session quick actions, no active session");

    activeTab = fakeTab({ id: "tab-1", label: "pwsh" });
    updateQuickButton();
    expect(button().getAttribute("aria-label")).toBe("Session quick actions: pwsh, connected");
    expect(button().title).toBe("Session quick actions: pwsh, connected");

    activeTab = fakeTab({ id: "tab-1", label: "pwsh", disconnected: true });
    updateQuickButton();
    expect(button().getAttribute("aria-label")).toBe("Session quick actions: pwsh, disconnected");

    activeTab = fakeTab({ id: "tab-1", label: "pwsh", shared: true });
    updateQuickButton();
    expect(button().getAttribute("aria-label")).toBe(
      "Session quick actions: pwsh, sharing with AI",
    );
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
    expect(p.querySelector(".qp-conn-connected")).not.toBeNull();
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
    expect(p.querySelector(".qp-share-url-row .tt-btn.tt-btn-solid")!.textContent).toBe("Copy");
  });
});

describe("quick panel — serial tab", () => {
  beforeEach(() => {
    activeTab = fakeTab({
      id: "tab-7",
      type: "serial",
      serialBaud: 115200,
      outputNewline: "keep",
      serialProfile: "Normal",
    });
  });

  // Rows are matched by their label span (select option text like
  // "Hardware (RTS/CTS)" would collide with a plain textContent search).
  function rowOf(sec: Element, label: string): HTMLElement | undefined {
    return [...sec.querySelectorAll<HTMLElement>(".qp-row")].find(
      (r) => r.querySelector(".qp-label")?.textContent === label,
    );
  }

  // -- custom select helpers (design listbox, no native <select>) --
  function selectOf(row: Element): HTMLElement {
    const root = row.querySelector<HTMLElement>(".tt-select");
    if (!root) throw new Error(".tt-select missing in row");
    return root;
  }
  function selectText(row: Element): string {
    return selectOf(row).querySelector(".tt-select-value")!.textContent!;
  }
  function pick(row: Element, value: string): void {
    const root = selectOf(row);
    root.querySelector<HTMLElement>(".tt-select-trigger")!.click();
    expect(root.classList.contains("open")).toBe(true);
    // Open menus are portaled to <body> (Q8).
    const opt = document.querySelector<HTMLElement>(
      `body > .tt-select-menu .tt-option[data-value="${value}"]`,
    );
    expect(opt, `option ${value}`).toBeTruthy();
    opt!.click();
    expect(root.classList.contains("open")).toBe(false);
  }

  const session = (p: HTMLElement) => p.querySelector('[data-section="serial"]')!;
  const io = (p: HTMLElement) => p.querySelector('[data-section="serial-io"]')!;
  const modem = (p: HTMLElement) => p.querySelector('[data-section="serial-modem"]')!;

  it("splits into Session / I/O / Modem lines sections per the design", () => {
    const p = openPanel();
    const sec = session(p);
    // Auto-reconnect first; then Connection / Profile / Baud / Frame.
    const firstRow = sec.querySelector<HTMLElement>(".qp-row")!;
    expect(firstRow.querySelector(".qp-label")!.textContent).toBe("Auto-reconnect");
    expect(rowOf(sec, "Connection")).toBeDefined();
    expect(rowOf(sec, "Profile")).toBeDefined();
    expect(rowOf(sec, "Baud rate")).toBeDefined();
    expect(rowOf(sec, "Frame")).toBeDefined();
    expect(rowOf(io(p), "Input mode")).toBeDefined();
    expect(rowOf(io(p), "Enter sends")).toBeDefined();
    expect(rowOf(io(p), "Output newlines")).toBeDefined();
    expect(rowOf(modem(p), "Flow control")).toBeDefined();
  });

  it("profile select shows the current value with built-in profiles first", () => {
    const p = openPanel();
    const profileRow = rowOf(session(p), "Profile")!;
    expect(selectText(profileRow)).toBe("Normal");
    const root = selectOf(profileRow);
    const group = root.querySelector(".tt-optgroup")!;
    expect(group.textContent).toBe("Built-in");
    const values = [...root.querySelectorAll<HTMLElement>(".tt-option")].map(
      (o) => o.dataset.value,
    );
    expect(values.slice(0, 3)).toEqual(["Normal", "Log", "AT"]);
    // The current option carries the selected marker + check.
    const selected = root.querySelector('.tt-option[aria-selected="true"]')!;
    expect(selected.dataset.value).toBe("Normal");
  });

  it("selecting the AT profile calls setSerialProfile", () => {
    const p = openPanel();
    pick(rowOf(session(p), "Profile")!, "AT");
    expect(handlers.setSerialProfile).toHaveBeenCalledWith("tab-7", "AT");
  });

  it("baud select change calls setSerialBaud with a number", () => {
    const p = openPanel();
    const baudRow = rowOf(session(p), "Baud rate")!;
    expect(selectText(baudRow)).toBe("115200");
    pick(baudRow, "9600");
    expect(handlers.setSerialBaud).toHaveBeenCalledWith("tab-7", 9600);
  });

  it("frame select offers 8N1/8E1/8O1 and calls setSerialFrame", () => {
    const p = openPanel();
    const frameRow = rowOf(session(p), "Frame")!;
    expect(selectText(frameRow)).toBe("8N1");
    expect(session(p).querySelector(".tt-select-hint")).toBeNull();
    pick(frameRow, "8E1");
    expect(handlers.setSerialFrame).toHaveBeenCalledWith("tab-7", "8E1");
  });

  it("parameter selects call the live session-only handlers", () => {
    const p = openPanel();
    const inputRow = rowOf(io(p), "Input mode")!;
    expect(selectText(inputRow)).toBe("Normal");
    pick(inputRow, "echo");
    expect(handlers.setSerialInputMode).toHaveBeenCalledWith("tab-7", "echo");

    const enterRow = rowOf(io(p), "Enter sends")!;
    expect(selectText(enterRow)).toBe("CR (\\r)");
    pick(enterRow, "crlf");
    expect(handlers.setSerialEnterNewline).toHaveBeenCalledWith("tab-7", "crlf");

    const outRow = rowOf(io(p), "Output newlines")!;
    expect(selectText(outRow)).toBe("Keep (raw)");
    pick(outRow, "cr-in-lf");
    expect(handlers.setSerialOutputNewline).toHaveBeenCalledWith("tab-7", "cr-in-lf");
  });

  it("Output newlines select shows a live help line and per-option tooltips", () => {
    const p = openPanel();
    const outRow = rowOf(io(p), "Output newlines")!;
    const hint = io(p).querySelector<HTMLElement>(".tt-select-hint")!;
    // Default keep: hint explains the current selection.
    expect(hint.textContent).toContain("Pass through unchanged");
    for (const opt of outRow.querySelectorAll<HTMLElement>(".tt-option")) {
      expect(opt.title.length).toBeGreaterThan(0);
    }
    // Switching updates the hint; the handler still fires.
    pick(outRow, "force-crlf");
    expect(hint.textContent).toBe("\\r | \\n | \\r\\n → \\r\\n");
    expect(handlers.setSerialOutputNewline).toHaveBeenCalledWith("tab-7", "force-crlf");
  });

  it("queries modem lines on open; signal rows always visible; auto-reconnect toggle works", async () => {
    const p = openPanel();
    expect(invokeMock).toHaveBeenCalledWith("serial_line_status", { id: "tab-7" });
    const sec = modem(p);
    // The signal block no longer hides at flow=none: open drives no modem
    // line, so the toggles are the only way to raise RTS/DTR.
    expect(rowOf(sec, "RTS")).toBeDefined();
    expect(rowOf(sec, "DTR")).toBeDefined();
    switchOf(rowOf(session(p), "Auto-reconnect")!).click();
    expect(invokeMock).toHaveBeenCalledWith("session_set_auto_reconnect", {
      id: "tab-7",
      enabled: true,
    });
  });

  it("flow control select calls serial_set_flow_control; signal rows reflect queried state", async () => {
    const p = openPanel();
    const sec = modem(p);
    const flowRow = rowOf(sec, "Flow control")!;
    expect(selectText(flowRow)).toBe("None");
    expect(selectOf(flowRow).classList.contains("tt-disabled")).toBe(false);
    pick(flowRow, "hardware");
    expect(invokeMock).toHaveBeenCalledWith("serial_set_flow_control", {
      id: "tab-7",
      flow: "hardware",
    });

    await vi.waitFor(() => {
      expect(rowOf(sec, "CTS")!.querySelector(".qp-led")!.textContent).toBe("high");
    });
    expect(rowOf(sec, "CTS")!.querySelector(".qp-led")!.classList.contains("on")).toBe(true);
    expect(rowOf(sec, "DSR")!.querySelector(".qp-led")!.textContent).toBe("high");

    // Hardware RTS/CTS: RTS is driver-owned (toggle disabled, no IPC).
    // DTR is not part of that handshake and stays software-controlled.
    assertModemHardware(p);
    invokeMock.mockClear();
    const rtsSwitch = switchOf(rowOf(sec, "RTS")!) as HTMLButtonElement;
    rtsSwitch.click();
    expect(invokeMock).not.toHaveBeenCalledWith("serial_set_rts", expect.anything());

    switchOf(rowOf(sec, "DTR")!).click();
    expect(invokeMock).toHaveBeenCalledWith("serial_set_dtr", { id: "tab-7", on: false });
  });

  it("greys out flow control when the port does not support modem lines", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "serial_line_status")
        return Promise.resolve({
          rts: false,
          cts: false,
          dtr: false,
          dsr: false,
          supported: false,
        });
      if (cmd === "session_get_auto_reconnect") return Promise.resolve(false);
      return Promise.resolve(null);
    });
    activeTab = fakeTab({
      id: "tab-7",
      type: "serial",
      serialProfile: "Normal",
      flowControl: "hardware",
    });
    const p = openPanel();
    const sec = modem(p);
    const flowRow = rowOf(sec, "Flow control")!;
    await vi.waitFor(() => {
      expect(selectOf(flowRow).classList.contains("tt-disabled")).toBe(true);
    });
    assertModemUnsupported(p);
  });

  it("greys out flow control when the line-status query fails", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "serial_line_status") return Promise.reject(new Error("io error"));
      if (cmd === "session_get_auto_reconnect") return Promise.resolve(false);
      return Promise.resolve(null);
    });
    const p = openPanel();
    const sec = modem(p);
    const flowRow = rowOf(sec, "Flow control")!;
    await vi.waitFor(() => {
      expect(selectOf(flowRow).classList.contains("tt-disabled")).toBe(true);
    });
    expect(flowRow.classList.contains("qp-disabled")).toBe(true);
  });
});

describe("quick panel — ssh tab", () => {
  it("embedded client shows the grouped forward table and adds one inline", async () => {
    invokeMock.mockImplementation((cmd: unknown) => {
      if (cmd === "ssh_forward_list") return Promise.resolve([]);
      if (cmd === "ssh_forward_add") return Promise.resolve(7);
      return Promise.resolve(null);
    });
    activeTab = fakeTab({ id: "tab-3", type: "ssh", sshEmbedded: true });
    const p = openPanel();
    const session = p.querySelector('[data-section="ssh"]')!;
    const forwards = p.querySelector('[data-section="forwards"]')!;
    expect(session.textContent).toContain("Auto-reconnect");
    expect(session.querySelector(".qp-fwd-slot")).toBeNull();
    // Grouped table: Local/Remote/Dynamic sections with add-rows.
    await vi.waitFor(() => {
      expect(forwards.querySelectorAll(".ft-group")).toHaveLength(3);
    });
    const localAdd = forwards
      .querySelectorAll<HTMLElement>(".ft-group")[0]
      .querySelector<HTMLElement>(".ft-add-row")!;
    localAdd.querySelector<HTMLInputElement>('input[aria-label="Listen port"]')!.value = "8080";
    localAdd.querySelector<HTMLInputElement>('input[aria-label="Target host"]')!.value =
      "db.internal";
    localAdd.querySelector<HTMLInputElement>('input[aria-label="Target port"]')!.value = "5432";
    localAdd.querySelector<HTMLButtonElement>(".ft-add")!.click();
    await vi.waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("ssh_forward_add", {
        id: "tab-3",
        kind: "local",
        listenHost: "127.0.0.1",
        listenPort: 8080,
        targetHost: "db.internal",
        targetPort: 5432,
      });
    });
    // Runtime forwards are not inline-editable (delete + re-add instead).
    expect(forwards.querySelector(".ft-edit")).toBeNull();

    // Regression: a runtime-added row must carry its backend forwardId —
    // deleting it addresses ssh_forward_remove with that id, not undefined.
    const row = await vi.waitFor(() => {
      const r = forwards.querySelector<HTMLElement>(".ft-group .ft-row:not(.ft-add-row)");
      expect(r?.textContent).toContain("db.internal:5432");
      return r!;
    });
    row.querySelector<HTMLButtonElement>(".ft-del")!.click();
    await vi.waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("ssh_forward_remove", { id: "tab-3", forwardId: 7 });
    });
  });

  it("external ssh hides the forwards block", async () => {
    activeTab = fakeTab({ id: "tab-4", type: "ssh", sshEmbedded: false });
    const p = openPanel();
    const sec = p.querySelector('[data-section="ssh"]')!;
    expect(sec.textContent).toContain("Auto-reconnect");
    expect(p.querySelector('[data-section="forwards"]')).toBeNull();
    expect(sec.querySelector(".qp-fwd-slot")).toBeNull();
  });
});

describe("quick panel — dismissal", () => {
  it("closes on outside click", async () => {
    activeTab = fakeTab({ id: "tab-1" });
    const p = openPanel();
    expect(p.classList.contains("open")).toBe(true);
    document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(p.classList.contains("open")).toBe(false);
  });

  it("Escape closes only an open select — the panel stays open (design)", async () => {
    activeTab = fakeTab({
      id: "tab-7",
      type: "serial",
      serialBaud: 115200,
      outputNewline: "keep",
      serialProfile: "Normal",
    });
    const p = openPanel();
    const root = p.querySelector<HTMLElement>('.tt-select[aria-label="Baud rate"]')!;
    root.querySelector<HTMLElement>(".tt-select-trigger")!.click();
    expect(root.classList.contains("open")).toBe(true);

    root.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(root.classList.contains("open")).toBe(false);
    expect(p.classList.contains("open")).toBe(true);

    // Even with no select open, Escape never closes the panel itself.
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(p.classList.contains("open")).toBe(true);
  });
});
