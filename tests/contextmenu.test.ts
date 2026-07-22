import { describe, it, expect, vi, beforeEach } from "vitest";

const serialTab = {
  type: "serial",
  serialPortName: "COM3",
  serialBaud: 115200,
  terminal: { getSelection: () => "", paste: vi.fn() },
};
const localTab = { type: "local", terminal: { getSelection: () => "", paste: vi.fn() } };

const { tabManagerMock } = vi.hoisted(() => ({
  tabManagerMock: {
    get: vi.fn(),
    setSerialBaud: vi.fn(),
    activeTabId: null as string | null,
  },
}));
vi.mock("../src/tabmanager", () => ({ tabManager: tabManagerMock }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.resolve(null)) }));

import { showTerminalContextMenu } from "../src/contextmenu";

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
    tabManagerMock.get.mockReturnValue(serialTab);
    showTerminalContextMenu("tab-1", 100, 100);
    expect(baudItem().style.display).toBe("");

    const options = [...document.querySelectorAll<HTMLElement>(".baud-option")];
    expect(options).toHaveLength(8);
    const checked = options.filter(o => o.textContent!.includes("✓"));
    expect(checked).toHaveLength(1);
    expect(checked[0].textContent).toBe("115200 ✓");
  });

  it("hides the baud item for non-serial tabs", () => {
    tabManagerMock.get.mockReturnValue(localTab);
    showTerminalContextMenu("tab-2", 100, 100);
    expect(baudItem().style.display).toBe("none");
  });

  it("clicking a baud option calls setSerialBaud and closes the menu", () => {
    tabManagerMock.get.mockReturnValue(serialTab);
    showTerminalContextMenu("tab-1", 100, 100);
    const opt9600 = [...document.querySelectorAll<HTMLElement>(".baud-option")]
      .find(o => o.dataset.baud === "9600")!;
    opt9600.click();
    expect(tabManagerMock.setSerialBaud).toHaveBeenCalledWith("tab-1", 9600);
    expect(document.getElementById("tab-context-menu")!.classList.contains("open")).toBe(false);
  });
});
