import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Tauri IPC layer before importing any app module.
const defaultInvoke = (cmd: string) => {
  if (cmd === "serial_list_ports") {
    return Promise.resolve([
      { name: "COM3", driver: "usbser", manufacturer: "wch.cn", product: "USB-SERIAL CH340", vid: "1A86", pid: "7523" },
      { name: "COM5", driver: "FTDIBUS", manufacturer: "FTDI", product: "", vid: "0403", pid: "6001" },
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
    invokeMock.mockReset();
    invokeMock.mockImplementation(defaultInvoke);
  });

  async function openMenu() {
    const m = await import("../src/profilemenu");
    m.initProfileMenu();
    (document.getElementById("new-tab-menu-btn")!).click();
    // allow the async re-enumeration + repopulate to complete
    await vi.waitFor(() => {
      const titles = [...document.querySelectorAll(".profile-section-title")].map(e => e.textContent);
      expect(titles).toContain("Serial");
    });
  }

  it("shows a Serial column with enumerated ports", async () => {
    await openMenu();
    const items = [...document.querySelectorAll(".profile-menu .profile-item")];
    const com3 = items.find(i => i.querySelector(".item-label")?.textContent === "COM3");
    expect(com3).toBeTruthy();
    expect(com3!.querySelector(".item-detail")!.textContent).toContain("USB-SERIAL CH340");
    expect(com3!.querySelector(".item-detail")!.textContent).toContain("1A86:7523");
  });

  it("falls back to manufacturer when product is empty", async () => {
    await openMenu();
    const items = [...document.querySelectorAll(".profile-menu .profile-item")];
    const com5 = items.find(i => i.querySelector(".item-label")?.textContent === "COM5");
    expect(com5!.querySelector(".item-detail")!.textContent).toContain("FTDI");
    expect(com5!.querySelector(".item-detail")!.textContent).toContain("0403:6001");
  });

  it("marks serial items as disabled (sessions not yet supported)", async () => {
    await openMenu();
    const items = [...document.querySelectorAll(".profile-menu .profile-item")];
    const com3 = items.find(i => i.querySelector(".item-label")?.textContent === "COM3");
    expect(com3!.classList.contains("disabled")).toBe(true);
    expect(com3!.title).toContain("not supported");
  });

  it("omits the Serial column when no ports are present", async () => {
    invokeMock.mockImplementation((cmd: string) =>
      Promise.resolve(cmd === "serial_list_ports" ? [] : null));
    const m = await import("../src/profilemenu");
    m.initProfileMenu();
    (document.getElementById("new-tab-menu-btn")!).click();
    await new Promise(r => setTimeout(r, 50));
    const titles = [...document.querySelectorAll(".profile-section-title")].map(e => e.textContent);
    expect(titles).not.toContain("Serial");
  });

  it("always shows the Local column with the default shell", async () => {
    await openMenu();
    const titles = [...document.querySelectorAll(".profile-section-title")].map(e => e.textContent);
    expect(titles[0]).toBe("Local");
  });
});
