import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.resolve(null)) }));

import { showTerminalContextMenu, setContextMenuHandlers, type ContextMenuHandlers } from "../src/terminal/contextmenu";

const handlers: ContextMenuHandlers = {
  createLocalTab: vi.fn(),
  newWindow: vi.fn(),
  getTabLabel: vi.fn(),
  setTabColor: vi.fn(),
  renameTab: vi.fn(),
  duplicateTab: vi.fn(),
  closeTab: vi.fn(),
  closeTabsRight: vi.fn(),
  closeOtherTabs: vi.fn(),
  getSelection: vi.fn(),
  pasteToTab: vi.fn(),
  clearTab: vi.fn(),
  switchTo: vi.fn(),
  exportTab: vi.fn(),
  setSerialBaud: vi.fn(),
  setSerialEnterNewline: vi.fn(),
  setSerialOutputNewline: vi.fn(),
  isSerialTab: vi.fn(),
  getSerialBaud: vi.fn(),
  getSerialOutputNewline: vi.fn(),
  getSerialEnterNewline: vi.fn(),
  getActiveTabId: vi.fn(),
  shareTab: vi.fn(),
  isTabShared: vi.fn(),
  getShareUrl: vi.fn(),
};

setContextMenuHandlers(handlers);

describe("terminal context menu — baud rate submenu", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.getElementById("tab-context-menu")?.classList.remove("open");
  });

  function baudItem() {
    return [...document.querySelectorAll<HTMLElement>(".menu-item.has-submenu")]
      .find(el => el.textContent?.includes("Baud Rate"))!;
  }

  it("shows the baud item for serial tabs with a checkmark on the current baud", () => {
    vi.mocked(handlers.isSerialTab).mockReturnValue(true);
    vi.mocked(handlers.getSerialBaud).mockReturnValue(115200);
    showTerminalContextMenu("tab-1", 100, 100);
    expect(baudItem().style.display).toBe("");

    const options = [...document.querySelectorAll<HTMLElement>(".baud-option")];
    expect(options).toHaveLength(8);
    const checked = options.filter(o => o.textContent!.includes("\u2713"));
    expect(checked).toHaveLength(1);
    expect(checked[0].textContent).toBe("115200 \u2713");
  });

  it("hides the baud item for non-serial tabs", () => {
    vi.mocked(handlers.isSerialTab).mockReturnValue(false);
    showTerminalContextMenu("tab-2", 100, 100);
    expect(baudItem().style.display).toBe("none");
  });

  it("clicking a baud option calls setSerialBaud and closes the menu", () => {
    vi.mocked(handlers.isSerialTab).mockReturnValue(true);
    vi.mocked(handlers.getSerialBaud).mockReturnValue(115200);
    showTerminalContextMenu("tab-1", 100, 100);
    const opt9600 = [...document.querySelectorAll<HTMLElement>(".baud-option")]
      .find(o => o.dataset.baud === "9600")!;
    opt9600.click();
    expect(handlers.setSerialBaud).toHaveBeenCalledWith("tab-1", 9600);
    expect(document.getElementById("tab-context-menu")!.classList.contains("open")).toBe(false);
  });
});
