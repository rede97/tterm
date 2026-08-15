import { beforeEach, describe, expect, it, vi } from "vitest";

// Spyable tabManager — avoids instantiating real xterm terminals in happy-dom.
const { tabManagerMock } = vi.hoisted(() => ({
  tabManagerMock: {
    createLocalTab: vi.fn(),
    createSshTab: vi.fn(),
    createSerialTab: vi.fn(),
    createDemoTab: vi.fn(),
  },
}));
vi.mock("../src/terminal/tabmanager", () => ({ tabManager: tabManagerMock }));

// Mock the Tauri IPC layer before importing any app module.
const defaultInvoke = (cmd: string) => {
  if (cmd === "serial_list_ports") {
    return Promise.resolve([
      {
        name: "COM3",
        driver: "usbser",
        manufacturer: "wch.cn",
        product: "USB-SERIAL CH340",
        vid: "1A86",
        pid: "7523",
      },
      {
        name: "COM5",
        driver: "FTDIBUS",
        manufacturer: "FTDI",
        product: "",
        vid: "0403",
        pid: "6001",
      },
    ]);
  }
  return Promise.resolve(null);
};
const invokeMock = vi.fn(defaultInvoke);
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

describe("profile menu (serial enumeration)", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <button id="new-tab-menu-btn"></button>
      <div id="tabs"></div>
      <div id="terminal-container"></div>
    `;
    document.querySelector(".profile-menu")?.remove();
    vi.resetModules();
    vi.clearAllMocks();
    invokeMock.mockImplementation(defaultInvoke);
  });

  async function openMenu() {
    const m = await import("../src/terminal/profilemenu");
    m.initProfileMenu();
    document.getElementById("new-tab-menu-btn")!.click();
    // allow the async re-enumeration + repopulate to complete
    await vi.waitFor(() => {
      const titles = [...document.querySelectorAll(".profile-section-title")].map(
        (e) => e.textContent,
      );
      expect(titles).toContain("Serial");
    });
  }

  function serialItem(label: string): Element {
    const items = [...document.querySelectorAll(".profile-menu .profile-item")];
    const hit = items.find((i) => i.querySelector(".item-label")?.textContent === label);
    expect(hit, `menu item ${label}`).toBeTruthy();
    return hit!;
  }

  it("line 1: COM name · friendly name; line 2: vendor VID:PID", async () => {
    await openMenu();
    const com3 = serialItem("COM3 · USB-SERIAL CH340");
    expect(com3.querySelector(".item-subline")!.textContent).toBe("wch.cn 1A86:7523");
    const com5 = serialItem("COM5 · FTDIBUS");
    expect(com5.querySelector(".item-subline")!.textContent).toBe("FTDI 0403:6001");
  });

  it("serial items are enabled and open a serial tab on click", async () => {
    await openMenu();
    const com3 = serialItem("COM3 · USB-SERIAL CH340");
    expect(com3.classList.contains("disabled")).toBe(false);
    (com3 as HTMLElement).click();
    expect(tabManagerMock.createSerialTab).toHaveBeenCalledTimes(1);
    expect(tabManagerMock.createSerialTab.mock.calls[0][0]).toMatchObject({
      name: "COM3",
      vid: "1A86",
      pid: "7523",
    });
  });

  it("closes the menu after clicking a serial item", async () => {
    await openMenu();
    (serialItem("COM5 · FTDIBUS") as HTMLElement).click();
    expect(document.querySelector(".profile-menu")!.classList.contains("open")).toBe(false);
  });

  it("omits the Serial column when no ports are present", async () => {
    invokeMock.mockImplementation((cmd: string) =>
      Promise.resolve(cmd === "serial_list_ports" ? [] : null),
    );
    const m = await import("../src/terminal/profilemenu");
    m.initProfileMenu();
    document.getElementById("new-tab-menu-btn")!.click();
    await new Promise((r) => setTimeout(r, 50));
    const titles = [...document.querySelectorAll(".profile-section-title")].map(
      (e) => e.textContent,
    );
    expect(titles).not.toContain("Serial");
  });

  it("always shows the Local column with the default shell", async () => {
    await openMenu();
    const titles = [...document.querySelectorAll(".profile-section-title")].map(
      (e) => e.textContent,
    );
    expect(titles[0]).toBe("Local");
  });

  it("shows the Demo TTY entry in dev mode and opens a demo tab on click", async () => {
    await openMenu();
    // vitest runs with import.meta.env.DEV = true
    const items = [...document.querySelectorAll(".profile-menu .profile-item")];
    const demo = items.find((i) => i.querySelector(".item-label")?.textContent === "Demo TTY");
    expect(demo).toBeTruthy();
    (demo as HTMLElement).click();
    expect(tabManagerMock.createDemoTab).toHaveBeenCalledTimes(1);
  });

  it("menu entries are native buttons", async () => {
    await openMenu();
    const items = [...document.querySelectorAll(".profile-menu .profile-item")];
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.tagName).toBe("BUTTON");
      expect((item as HTMLButtonElement).type).toBe("button");
    }
  });

  function pressKey(key: string) {
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    );
  }

  it("open focuses the first entry; arrows and Home/End move within the menu", async () => {
    await openMenu();
    const items = [...document.querySelectorAll<HTMLElement>(".profile-menu .profile-item")];
    expect(document.activeElement).toBe(items[0]);

    pressKey("ArrowDown");
    expect(document.activeElement).toBe(items[1]);
    pressKey("ArrowUp");
    expect(document.activeElement).toBe(items[0]);
    pressKey("End");
    expect(document.activeElement).toBe(items[items.length - 1]);
    pressKey("Home");
    expect(document.activeElement).toBe(items[0]);
    pressKey("ArrowUp"); // wraps to the last entry
    expect(document.activeElement).toBe(items[items.length - 1]);
  });

  it("Enter activates the focused entry and closes the menu", async () => {
    await openMenu();
    const first = document.querySelector<HTMLElement>(".profile-menu .profile-item")!;
    expect(document.activeElement).toBe(first);

    pressKey("Enter");
    expect(tabManagerMock.createLocalTab).toHaveBeenCalledTimes(1);
    expect(document.querySelector(".profile-menu")!.classList.contains("open")).toBe(false);
  });

  it("Escape closes the menu and returns focus to the menu button", async () => {
    await openMenu();
    pressKey("Escape");
    expect(document.querySelector(".profile-menu")!.classList.contains("open")).toBe(false);
    expect(document.activeElement).toBe(document.getElementById("new-tab-menu-btn"));
  });
});
