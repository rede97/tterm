// TerminalTab.destroy() cleanup chain: every resource the tab owns must be
// released — socket closed, attach addon disposed, IME document listeners
// removed, re-anchor interval stopped, re-attach timer cancelled, DOM
// removed, terminal disposed. Gaps here leak relay slots and intervals that
// keep poking a disposed xterm (audit R8).
import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn(() => Promise.resolve(null)) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }));

const sockets: FakeSocket[] = [];
class FakeSocket {
  static OPEN = 1;
  readyState = 0;
  closed = false;
  listeners = new Map<string, ((e?: unknown) => void)[]>();
  constructor(public url: string) {
    sockets.push(this);
  }
  send() {}
  close() {
    this.closed = true;
    this.readyState = 3;
  }
  addEventListener(type: string, fn: (e?: unknown) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  fire(type: string, e?: unknown) {
    for (const fn of this.listeners.get(type) ?? []) fn(e);
  }
}
vi.stubGlobal("WebSocket", FakeSocket);

import { configStore } from "../src/core/store";
import { TerminalTab } from "../src/terminal/tab";
import { setImeDebugFlags } from "../src/util/imebox";

function makeTab(id = "tab-1"): { tab: TerminalTab; container: HTMLElement } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const tab = new TerminalTab(id, "local", "probe", container);
  // TabManager assigns this after construction (_createTabElement).
  const tabEl = document.createElement("div");
  document.body.appendChild(tabEl);
  tab.tabElement = tabEl;
  // TabManager calls this once the backend session exists.
  tab.attachSocket(1234, "tok");
  return { tab, container };
}

beforeEach(() => {
  sockets.length = 0;
  configStore.set({ renderer: "dom" });
  document.body.innerHTML = "";
});

describe("TerminalTab.destroy cleanup chain", () => {
  it("closes the attach socket so the relay slot is released", () => {
    const { tab } = makeTab();
    expect(sockets).toHaveLength(1);
    tab.destroy();
    expect(sockets[0].closed).toBe(true);
  });

  it("removes the terminal element and tab element from the DOM", () => {
    const { tab, container } = makeTab();
    tab.destroy();
    expect(container.querySelector(".terminal-instance")).toBeNull();
    expect(document.body.contains(tab.tabElement)).toBe(false);
  });

  it("stops the IME re-anchor interval when destroyed mid-composition", () => {
    const { tab } = makeTab();
    setImeDebugFlags({ suppress: true, reanchor: true });
    const ta = tab.element.querySelector("textarea")!;
    ta.dispatchEvent(new CompositionEvent("compositionstart", { data: "" }));

    const clearSpy = vi.spyOn(window, "clearInterval");
    tab.destroy();
    setImeDebugFlags({ suppress: false, reanchor: false });
    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });

  it("cancels a pending re-attach retry timer", () => {
    const { tab } = makeTab();
    // Drive the tab into the retry path: socket closes abnormally.
    sockets[0].fire("close", { code: 1006, wasClean: false });

    const clearSpy = vi.spyOn(window, "clearTimeout");
    tab.destroy();
    // destroy() must cancel the scheduled retry — otherwise it fires into
    // a disposed tab (and opens a socket nobody owns).
    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });

  it("ignores socket events arriving after destroy (stale gen)", () => {
    const { tab } = makeTab();
    tab.destroy();
    const before = sockets.length;
    // A late close event from the pre-destroy socket must not schedule a
    // re-attach (socketGen bumped by destroy).
    sockets[0].fire("close", { code: 1006, wasClean: false });
    expect(sockets.length).toBe(before);
  });
});
