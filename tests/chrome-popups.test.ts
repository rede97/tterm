import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve(null)),
}));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  readText: vi.fn(() => Promise.resolve("")),
  writeText: vi.fn(() => Promise.resolve()),
}));

import {
  closeContextMenu,
  showTabContextMenu,
  showTerminalContextMenu,
} from "../src/terminal/contextmenu";
import { closeDirectoryMenu, showDirectoryMenu } from "../src/terminal/dirmenu";
import {
  closeQuickPanel,
  initQuickPanel,
  type QuickPanelHandlers,
  setQuickPanelHandlers,
} from "../src/terminal/quickpanel";
import type { TerminalTab } from "../src/terminal/tab";
import {
  openCommandPalette,
  openPaletteFlow,
  type PaletteHandlers,
  paletteOpen,
  setPaletteHandlers,
} from "../src/ui/palette";
import { openQuickOpen, setTabSwitcherHandlers, tabSwitcherOpen } from "../src/ui/tabswitcher";

function fakeTab(id: string): TerminalTab {
  return {
    id,
    label: id,
    type: "local",
    shared: false,
    disconnected: false,
    sshEmbedded: false,
  } as unknown as TerminalTab;
}

describe("chrome popups are exclusive", () => {
  const handlers = {
    getActiveTab: vi.fn(() => fakeTab("tab-1")),
    getTab: vi.fn((id: string) => (id === "tab-1" ? fakeTab("tab-1") : undefined)),
    shareTab: vi.fn(() => Promise.resolve()),
    setSerialBaud: vi.fn(() => Promise.resolve()),
    setSerialFrame: vi.fn(() => Promise.resolve()),
    setSerialProfile: vi.fn(() => Promise.resolve()),
    setSerialInputMode: vi.fn(),
    setSerialOutputNewline: vi.fn(() => Promise.resolve()),
    setSerialEnterNewline: vi.fn(() => Promise.resolve()),
  } satisfies QuickPanelHandlers;

  function contextMenu(): HTMLElement {
    return document.getElementById("tab-context-menu")!;
  }

  function panel(): HTMLElement {
    return document.querySelector(".quick-panel")!;
  }

  function dirMenu(): HTMLElement | null {
    return document.querySelector(".dir-menu");
  }

  beforeEach(() => {
    closeContextMenu(false);
    closeQuickPanel();
    closeDirectoryMenu();
    document.body.innerHTML = `
      <button id="quick-status"></button>
      <div id="dummy-tab"></div>
      <button id="new-tab"></button>
    `;
    setQuickPanelHandlers(handlers);
    initQuickPanel();
  });

  it("opening the terminal context menu closes the quick panel", () => {
    document.getElementById("quick-status")!.click();
    expect(panel().classList.contains("open")).toBe(true);

    showTerminalContextMenu("tab-1", 40, 80);
    expect(panel().classList.contains("open")).toBe(false);
    expect(contextMenu().classList.contains("open")).toBe(true);
  });

  it("opening the quick panel closes the tab context menu", () => {
    showTabContextMenu("tab-1", document.getElementById("dummy-tab")!);
    expect(contextMenu().classList.contains("open")).toBe(true);

    document.getElementById("quick-status")!.click();
    expect(contextMenu().classList.contains("open")).toBe(false);
    expect(panel().classList.contains("open")).toBe(true);
  });

  it("opening the directory menu closes the terminal context menu", () => {
    showTerminalContextMenu("tab-1", 10, 10);
    expect(contextMenu().classList.contains("open")).toBe(true);

    showDirectoryMenu(document.getElementById("new-tab")!);
    expect(contextMenu().classList.contains("open")).toBe(false);
    expect(dirMenu()).not.toBeNull();
  });

  it("opening a context menu closes the directory menu", () => {
    showDirectoryMenu(document.getElementById("new-tab")!);
    expect(dirMenu()).not.toBeNull();

    showTabContextMenu("tab-1", document.getElementById("dummy-tab")!);
    expect(dirMenu()).toBeNull();
    expect(contextMenu().classList.contains("open")).toBe(true);
  });

  it("opening the profile menu closes the quick panel", async () => {
    document.body.insertAdjacentHTML("beforeend", `<button id="new-tab-menu-btn"></button>`);
    const { initProfileMenu } = await import("../src/terminal/profilemenu");
    initProfileMenu();

    document.getElementById("quick-status")!.click();
    expect(panel().classList.contains("open")).toBe(true);

    document.getElementById("new-tab-menu-btn")!.click();
    expect(panel().classList.contains("open")).toBe(false);
    expect(document.querySelector(".profile-menu")?.classList.contains("open")).toBe(true);
  });
});

describe("palette and tab switcher are exclusive", () => {
  const paletteHandlers: PaletteHandlers = {
    listLocalProfiles: () => [],
    listSshHosts: () => [],
    listSerialPorts: () => Promise.resolve([]),
    openLocalTab: vi.fn(),
    openSshTab: vi.fn(),
    openSerialTab: vi.fn(),
    getActiveTab: () => ({ id: "tab-1", type: "local" }),
    setSerialBaud: vi.fn(),
    setSerialProfile: vi.fn(),
    setSerialFrame: vi.fn(),
    setSerialFlow: vi.fn(),
    setSerialInputMode: vi.fn(),
    flipToQuickOpen: (q) => openQuickOpen(q),
  };

  beforeEach(() => {
    document.body.innerHTML = "";
    setPaletteHandlers(paletteHandlers);
    setTabSwitcherHandlers({
      listTabs: () => [
        {
          id: "tab-1",
          label: "one",
          index: 1,
          active: true,
          disconnected: false,
          kind: "local",
        },
      ],
      switchTo: vi.fn(),
      onCommandFlip: (q) => openCommandPalette(q),
    });
  });

  it("Ctrl+Shift+P replaces an open Ctrl+P overlay (one .pal-overlay)", () => {
    openQuickOpen();
    expect(tabSwitcherOpen()).toBe(true);
    expect(document.querySelectorAll(".pal-overlay")).toHaveLength(1);

    openCommandPalette();
    expect(tabSwitcherOpen()).toBe(false);
    expect(paletteOpen()).toBe(true);
    expect(document.querySelectorAll(".pal-overlay")).toHaveLength(1);
    expect(document.querySelector(".pal-prefix")?.classList.contains("on")).toBe(true);
  });

  it("Ctrl+P replaces an open command palette", () => {
    openCommandPalette();
    expect(paletteOpen()).toBe(true);

    openQuickOpen();
    expect(paletteOpen()).toBe(false);
    expect(tabSwitcherOpen()).toBe(true);
    expect(document.querySelectorAll(".pal-overlay")).toHaveLength(1);
  });

  it("a two-level palette page is the same overlay and still exclusive", async () => {
    openQuickOpen();
    openPaletteFlow("newLocal");
    await vi.waitFor(() =>
      expect(document.querySelector<HTMLInputElement>(".pal-input")?.placeholder).toContain(
        "Local shell",
      ),
    );
    expect(tabSwitcherOpen()).toBe(false);
    expect(paletteOpen()).toBe(true);
    expect(document.querySelectorAll(".pal-overlay")).toHaveLength(1);

    openQuickOpen();
    expect(paletteOpen()).toBe(false);
    expect(tabSwitcherOpen()).toBe(true);
    expect(document.querySelectorAll(".pal-overlay")).toHaveLength(1);
  });

  it("opening the command palette closes the quick panel", () => {
    document.body.innerHTML = `<button id="quick-status"></button>`;
    setQuickPanelHandlers({
      getActiveTab: () => fakeTab("tab-1"),
      getTab: () => fakeTab("tab-1"),
      shareTab: vi.fn(() => Promise.resolve()),
      setSerialBaud: vi.fn(() => Promise.resolve()),
      setSerialFrame: vi.fn(() => Promise.resolve()),
      setSerialProfile: vi.fn(() => Promise.resolve()),
      setSerialInputMode: vi.fn(),
      setSerialOutputNewline: vi.fn(() => Promise.resolve()),
      setSerialEnterNewline: vi.fn(),
    });
    initQuickPanel();
    document.getElementById("quick-status")!.click();
    expect(document.querySelector(".quick-panel")?.classList.contains("open")).toBe(true);

    openCommandPalette();
    expect(document.querySelector(".quick-panel")?.classList.contains("open")).toBe(false);
    expect(paletteOpen()).toBe(true);
  });
});
