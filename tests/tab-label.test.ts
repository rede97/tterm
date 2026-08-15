// Tab close button naming (P1-03): the strip's × button carries an
// accessible name that follows renames and OSC title changes.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.resolve(null)) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }));

import { configStore } from "../src/core/store";
import { TerminalTab } from "../src/terminal/tab";

beforeEach(() => {
  configStore.set({ renderer: "dom" });
  document.body.innerHTML = "";
});

describe("tab close button accessible name", () => {
  it("follows the tab label on rename", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const tab = new TerminalTab("tab-1", "local", "pwsh", container);

    // What TabManager._createTabElement builds, reduced to the contract.
    const tabEl = document.createElement("div");
    tabEl.innerHTML = `<span class="tab-label"></span><button class="tab-close">×</button>`;
    document.body.appendChild(tabEl);
    tab.tabElement = tabEl;

    tab.rename("deploy", true);
    expect(tabEl.querySelector(".tab-close")?.getAttribute("aria-label")).toBe("Close deploy");

    tab.rename("logs", true);
    expect(tabEl.querySelector(".tab-close")?.getAttribute("aria-label")).toBe("Close logs");
  });
});
