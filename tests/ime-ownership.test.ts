// Display-ownership lock: while a composition is in flight,
// refreshImeClasses must NOT flip the ime-mirror-on suppression class —
// Agent TUIs flicker the hardware cursor around input fields, and a
// mid-composition flip is what made the mirror vanish / the OS native
// box appear. See docs/ime-anchor-stability.md.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { cursorIsHiddenMock } = vi.hoisted(() => ({ cursorIsHiddenMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.resolve(null)) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }));
vi.mock("../src/util/xterm-internals", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  cursorIsHidden: cursorIsHiddenMock,
}));

import { configStore } from "../src/core/store";
import { TerminalTab } from "../src/terminal/tab";
import { setImeMirrorMode } from "../src/util/imebox";

function makeTab(): TerminalTab {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const tab = new TerminalTab("tab-1", "local", "probe", container);
  const tabEl = document.createElement("div");
  document.body.appendChild(tabEl);
  tab.tabElement = tabEl;
  return tab;
}

function textareaOf(tab: TerminalTab): HTMLElement {
  const ta = tab.element.querySelector<HTMLElement>(".xterm-helper-textarea");
  expect(ta, "xterm helper textarea").toBeTruthy();
  return ta!;
}

function composition(target: HTMLElement, type: string, data = "") {
  const e = new Event(type, { bubbles: true });
  Object.assign(e, { data });
  target.dispatchEvent(e);
}

beforeEach(() => {
  vi.clearAllMocks();
  configStore.set({ renderer: "dom", imePinCorner: false });
  document.body.innerHTML = "";
  // The repo default is "always" (testing phase); ownership semantics are
  // exercised in "auto" — mirror only while the TUI hides the cursor.
  setImeMirrorMode("auto");
  cursorIsHiddenMock.mockReturnValue(true);
});

describe("IME display ownership lock", () => {
  it("mirror class follows cursor state when not composing", () => {
    const tab = makeTab();
    tab.refreshImeClasses();
    expect(tab.element.classList.contains("ime-mirror-on")).toBe(true);
    cursorIsHiddenMock.mockReturnValue(false);
    tab.refreshImeClasses();
    expect(tab.element.classList.contains("ime-mirror-on")).toBe(false);
    tab.destroy();
  });

  it("does not flip the suppression class mid-composition", () => {
    const tab = makeTab();
    tab.refreshImeClasses();
    expect(tab.element.classList.contains("ime-mirror-on")).toBe(true);

    // Composition starts (mirror owns display) — then the TUI flickers
    // the hardware cursor visible mid-composition.
    const ta = textareaOf(tab);
    composition(ta, "compositionstart");
    composition(ta, "compositionupdate", "ni");
    cursorIsHiddenMock.mockReturnValue(false);
    tab.refreshImeClasses();
    expect(tab.element.classList.contains("ime-mirror-on")).toBe(true); // locked

    // Composition ends: the class tracks the cursor state again.
    composition(ta, "compositionend", "你");
    tab.refreshImeClasses();
    expect(tab.element.classList.contains("ime-mirror-on")).toBe(false);
    tab.destroy();
  });

  it("fixed input box forces the mirror on and pins it to the bottom-left", () => {
    configStore.set({ imePinCorner: true });
    setImeMirrorMode("off");
    cursorIsHiddenMock.mockReturnValue(false);
    const tab = makeTab();
    Object.defineProperty(tab.element, "clientWidth", { value: 800, configurable: true });
    Object.defineProperty(tab.element, "clientHeight", { value: 600, configurable: true });
    tab.refreshImeClasses();
    expect(tab.element.classList.contains("ime-mirror-on")).toBe(true);

    const ta = textareaOf(tab);
    composition(ta, "compositionstart");
    composition(ta, "compositionupdate", "ni");
    const box = tab.element.querySelector<HTMLElement>(".ime-box");
    expect(box).toBeTruthy();
    expect(parseFloat(box?.style.left ?? "0")).toBeLessThan(20);
    expect(parseFloat(box?.style.top ?? "0")).toBeGreaterThan(500);
    // End the composition before dispose so xterm's 0ms composition timer
    // does not touch a torn-down renderer.
    composition(ta, "compositionend", "你");
    tab.destroy();
  });
});
