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
    if (cmd === "serial_line_status") return Promise.resolve({ rts: true, cts: true });
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
    activeTab = fakeTab({ id: "tab-7", type: "serial", serialBaud: 115200, outputNewline: "keep" });
  });

  it("shows serial controls and queries modem lines", async () => {
    const p = openPanel();
    const sec = p.querySelector('[data-section="serial"]')!;
    expect(sec).not.toBeNull();
    expect(invokeMock).toHaveBeenCalledWith("serial_line_status", { id: "tab-7" });
    expect(sec.textContent).toContain("Baud rate");
    expect(sec.textContent).toContain("Output newlines");
    expect(sec.textContent).toContain("Enter sends");
    expect(sec.textContent).toContain("RTS line");
    expect(sec.textContent).toContain("CTS line");
    await vi.waitFor(() => {
      expect(p.querySelector(".qp-line-val")!.textContent).toBe("asserted");
    });
  });

  it("baud select change calls setSerialBaud with a number", async () => {
    const p = openPanel();
    const sec = p.querySelector('[data-section="serial"]')!;
    const baudRow = [...sec.querySelectorAll<HTMLElement>(".qp-row")]
      .find((r) => r.textContent!.includes("Baud rate"))!;
    const sel = baudRow.querySelector("select")!;
    expect(sel.value).toBe("115200");
    sel.value = "9600";
    sel.dispatchEvent(new Event("change"));
    expect(handlers.setSerialBaud).toHaveBeenCalledWith("tab-7", 9600);
  });

  it("RTS toggle calls serial_set_rts; auto-reconnect toggle calls session_set_auto_reconnect", async () => {
    const p = openPanel();
    const sec = p.querySelector('[data-section="serial"]')!;
    const rows = [...sec.querySelectorAll<HTMLElement>(".qp-toggle-row")];
    const autoRow = rows.find((r) => r.textContent!.includes("Auto-reconnect"))!;
    const rtsRow = rows.find((r) => r.textContent!.includes("RTS line"))!;
    switchOf(rtsRow).click();
    expect(invokeMock).toHaveBeenCalledWith("serial_set_rts", { id: "tab-7", on: false });
    switchOf(autoRow).click();
    expect(invokeMock).toHaveBeenCalledWith("session_set_auto_reconnect", { id: "tab-7", enabled: true });
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
