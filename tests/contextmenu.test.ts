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
  getActiveTabId: vi.fn(),
  shareTab: vi.fn(),
  isTabShared: vi.fn(),
  getShareUrl: vi.fn(),
};

setContextMenuHandlers(handlers);

describe("terminal context menu", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.getElementById("tab-context-menu")?.classList.remove("open");
  });

  it("no longer carries serial baud/newline submenus (moved to the quick panel)", () => {
    showTerminalContextMenu("tab-1", 100, 100);
    const menu = document.getElementById("tab-context-menu")!;
    expect(menu.classList.contains("open")).toBe(true);
    expect(menu.querySelector(".baud-option")).toBeNull();
    expect(menu.querySelector(".nl-option")).toBeNull();
    expect(menu.querySelector(".enter-option")).toBeNull();
    expect(menu.textContent).not.toContain("Baud Rate");
    expect(menu.textContent).not.toContain("Output Newlines");
    expect(menu.textContent).not.toContain("Enter Sends");
  });
});
