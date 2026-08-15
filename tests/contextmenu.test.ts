import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.resolve(null)) }));

import {
  type ContextMenuHandlers,
  setContextMenuHandlers,
  showTabContextMenu,
  showTerminalContextMenu,
} from "../src/terminal/contextmenu";
import { initSearchBar, setSearchHandlers } from "../src/terminal/search";
import type { TerminalTab } from "../src/terminal/tab";

// Real search bar so the Find action's focus claim is observable.
setSearchHandlers({
  getTab: () =>
    ({
      searchAddon: {},
      searchQuery: "",
      terminal: { focus: () => {} },
    }) as unknown as TerminalTab,
});
const termContainer = document.createElement("div");
termContainer.id = "terminal-container";
document.body.appendChild(termContainer);
initSearchBar();

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

describe("context menu — semantics and keyboard model", () => {
  const menu = () => document.getElementById("tab-context-menu")!;
  const sub = () => menu().querySelector<HTMLElement>(".color-submenu")!;
  const colorItem = () =>
    [...menu().querySelectorAll<HTMLElement>(".menu-item")].find((i) =>
      i.textContent?.includes("Change Tab Color"),
    )!;
  const pressKey = (key: string) =>
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    );

  beforeEach(() => {
    vi.clearAllMocks();
    menu().classList.remove("open");
    sub().classList.remove("open");
    sub().style.display = "none";
    document.body.querySelector("#trigger")?.remove();
  });

  function openWithTrigger(show: () => void): HTMLElement {
    const trigger = document.createElement("button");
    trigger.id = "trigger";
    document.body.appendChild(trigger);
    trigger.focus();
    show();
    return trigger;
  }

  it("menu entries, swatches and the reset entry are native buttons", () => {
    showTabContextMenu("tab-1", 100, 100);
    const buttons = [...menu().querySelectorAll(".menu-item, .color-swatch, .color-clear")];
    expect(buttons.length).toBeGreaterThan(0);
    for (const b of buttons) expect(b.tagName).toBe("BUTTON");
  });

  it("open focuses the first entry; arrows skip hidden entries", () => {
    showTabContextMenu("tab-1", 100, 100);
    const visible = [...menu().querySelectorAll<HTMLElement>('[data-group="tab"] .menu-item')];
    expect(document.activeElement).toBe(visible[0]); // New Tab
    pressKey("ArrowDown");
    expect(document.activeElement).toBe(visible[1]); // Open in New Window
    pressKey("ArrowDown");
    expect(document.activeElement).toBe(colorItem());
    pressKey("ArrowDown");
    expect(document.activeElement?.textContent).toBe("Rename");
  });

  it("Enter executes the focused entry and closes the menu", () => {
    showTabContextMenu("tab-1", 100, 100);
    pressKey("Enter"); // New Tab
    expect(handlers.createLocalTab).toHaveBeenCalledTimes(1);
    expect(menu().classList.contains("open")).toBe(false);
  });

  it("Escape closes the menu and returns focus to the trigger", () => {
    const trigger = openWithTrigger(() => showTerminalContextMenu("tab-1", 100, 100));
    expect(menu().classList.contains("open")).toBe(true);
    expect(document.activeElement).not.toBe(trigger);
    pressKey("Escape");
    expect(menu().classList.contains("open")).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  it("color submenu opens with ArrowRight and picks a color with Enter", () => {
    showTabContextMenu("tab-1", 100, 100);
    pressKey("ArrowDown");
    pressKey("ArrowDown");
    expect(document.activeElement).toBe(colorItem());

    pressKey("ArrowRight");
    expect(sub().classList.contains("open")).toBe(true);
    expect(colorItem().getAttribute("aria-expanded")).toBe("true");
    const firstSwatch = sub().querySelector<HTMLElement>(".color-swatch")!;
    expect(document.activeElement).toBe(firstSwatch);

    pressKey("Enter");
    expect(handlers.setTabColor).toHaveBeenCalledWith("tab-1", "#e06c75");
    expect(menu().classList.contains("open")).toBe(false);
  });

  it("mouse can move from the color item into the flyout without closing it", () => {
    showTabContextMenu("tab-1", 100, 100);
    const wrap = colorItem().closest<HTMLElement>(".menu-submenu-wrap")!;

    wrap.dispatchEvent(new MouseEvent("mouseenter"));
    expect(sub().classList.contains("open")).toBe(true);

    // Moving between descendants stays inside the wrapper's hover region.
    colorItem().dispatchEvent(new MouseEvent("mouseleave"));
    sub().dispatchEvent(new MouseEvent("mouseenter"));
    expect(sub().classList.contains("open")).toBe(true);

    wrap.dispatchEvent(new MouseEvent("mouseleave"));
    expect(sub().classList.contains("open")).toBe(false);
  });

  it("color submenu Reset Color works from the keyboard", () => {
    showTabContextMenu("tab-1", 100, 100);
    pressKey("ArrowDown");
    pressKey("ArrowDown");
    pressKey("ArrowRight");
    pressKey("End"); // last submenu entry: Reset Color
    pressKey("Enter");
    expect(handlers.setTabColor).toHaveBeenCalledWith("tab-1", undefined);
    expect(menu().classList.contains("open")).toBe(false);
  });

  it("Escape inside the submenu returns to the parent item, then closes the menu", () => {
    showTabContextMenu("tab-1", 100, 100);
    pressKey("ArrowDown");
    pressKey("ArrowDown");
    pressKey("ArrowRight");
    expect(sub().classList.contains("open")).toBe(true);

    pressKey("Escape");
    expect(sub().classList.contains("open")).toBe(false);
    expect(menu().classList.contains("open")).toBe(true);
    expect(document.activeElement).toBe(colorItem());

    pressKey("Escape");
    expect(menu().classList.contains("open")).toBe(false);
  });

  it("Find keeps focus in the search input after the menu closes", () => {
    openWithTrigger(() => showTerminalContextMenu("tab-1", 100, 100));
    const find = [...menu().querySelectorAll<HTMLElement>(".menu-item")].find(
      (i) => i.textContent === "Find",
    )!;
    find.focus();
    pressKey("Enter");
    expect(menu().classList.contains("open")).toBe(false);
    expect(handlers.switchTo).toHaveBeenCalledWith("tab-1");
    // The action's own focus target wins over the menu's focus restore.
    expect(document.activeElement).toBe(document.querySelector("#search-bar input"));
  });
});
