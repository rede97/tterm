// Search bar control semantics (P1-03): the icon buttons carry readable
// names, and closing the bar returns focus to the bound terminal.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { closeFind, initSearchBar, openFind, setSearchHandlers } from "../src/terminal/search";
import type { TerminalTab } from "../src/terminal/tab";

const terminalFocus = vi.fn();
const fakeTab = {
  searchAddon: {},
  searchQuery: "",
  terminal: { focus: terminalFocus },
} as unknown as TerminalTab;

setSearchHandlers({ getTab: () => fakeTab });

// The search bar is a module singleton: init once, reset state per test.
document.body.innerHTML = `<div id="terminal-container"></div>`;
initSearchBar();

beforeEach(() => {
  closeFind(); // reset the singleton bar; may focus the fake terminal
  vi.clearAllMocks();
});

describe("search bar buttons", () => {
  it("prev/next/close buttons expose readable names", () => {
    const bar = document.getElementById("search-bar") as HTMLElement;
    const prev = bar.querySelector<HTMLElement>('button[aria-label="Previous match"]');
    const next = bar.querySelector<HTMLElement>('button[aria-label="Next match"]');
    const close = bar.querySelector<HTMLElement>('button[aria-label="Close search"]');
    expect(prev).not.toBeNull();
    expect(next).not.toBeNull();
    expect(close).not.toBeNull();
    expect(prev?.title).toBe("Previous match");
    expect(next?.title).toBe("Next match");
    expect(close?.title).toBe("Close search");
  });
});

describe("search bar focus", () => {
  it("openFind focuses the input; Escape closes and refocuses the terminal", () => {
    openFind("tab-1");
    const bar = document.getElementById("search-bar") as HTMLElement;
    const input = bar.querySelector("input") as HTMLInputElement;
    expect(bar.style.display).toBe("flex");
    expect(document.activeElement).toBe(input);

    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(bar.style.display).toBe("none");
    expect(terminalFocus).toHaveBeenCalledTimes(1);
  });

  it("close button closes and refocuses the terminal", () => {
    openFind("tab-1");
    const bar = document.getElementById("search-bar") as HTMLElement;
    bar.querySelector<HTMLButtonElement>('button[aria-label="Close search"]')?.click();
    expect(bar.style.display).toBe("none");
    expect(terminalFocus).toHaveBeenCalledTimes(1);
  });
});
