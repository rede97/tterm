import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.resolve(null)) }));

import {
  createShortcutsPanel,
  refreshShortcutsPanel,
  collectShortcutsSettings,
} from "../src/settings/shortcuts";
import { KEY_COMMANDS } from "../src/core/keymap";
import { configStore } from "../src/core/store";

function chip(panel: HTMLElement, commandId: string): HTMLButtonElement {
  const row = panel.querySelector<HTMLElement>(`.kb-row[data-command="${commandId}"]`)!;
  return row.querySelector<HTMLButtonElement>(".kb-chip")!;
}

function pressKey(el: HTMLElement, init: KeyboardEventInit & { key: string }): void {
  el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
}

describe("settings — Keyboard panel", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    configStore.set({ keybindings: {} });
  });

  it("renders every command with its default binding (clear ships unbound)", () => {
    const panel = createShortcutsPanel();
    expect(panel.querySelectorAll(".kb-row[data-command]")).toHaveLength(KEY_COMMANDS.length);
    expect(chip(panel, "workbench.action.quickOpen").textContent).toBe("Ctrl+P");
    const clearChip = chip(panel, "workbench.action.terminal.clear");
    expect(clearChip.textContent).toBe("Unbound");
    expect(clearChip.classList.contains("kb-chip-empty")).toBe(true);
  });

  it("recording a combo commits via Enter and collects as an override", () => {
    const panel = createShortcutsPanel();
    document.body.appendChild(panel);
    chip(panel, "workbench.action.terminal.clear").click();

    const capture = panel.querySelector<HTMLInputElement>(".kb-capture")!;
    expect(capture).toBeTruthy();
    pressKey(capture, { key: "l", ctrlKey: true });
    expect(capture.value).toBe("Ctrl+L");
    pressKey(capture, { key: "Enter" });

    expect(chip(panel, "workbench.action.terminal.clear").textContent).toBe("Ctrl+L");
    expect(chip(panel, "workbench.action.terminal.clear").classList.contains("kb-chip-modified")).toBe(true);
    expect(collectShortcutsSettings(panel)).toEqual({
      keybindings: { "workbench.action.terminal.clear": "ctrl+l" },
    });
  });

  it("a combo bound elsewhere is refused, not committed", () => {
    const panel = createShortcutsPanel();
    document.body.appendChild(panel);
    chip(panel, "workbench.action.terminal.clear").click();
    const capture = panel.querySelector<HTMLInputElement>(".kb-capture")!;

    pressKey(capture, { key: "p", ctrlKey: true }); // already quickOpen's
    expect(capture.classList.contains("kb-capture-conflict")).toBe(true);
    pressKey(capture, { key: "Enter" }); // refused: capture stays open
    expect(panel.querySelector(".kb-capture")).toBeTruthy();

    pressKey(capture, { key: "Escape" }); // cancel out
    expect(chip(panel, "workbench.action.terminal.clear").textContent).toBe("Unbound");
    expect(collectShortcutsSettings(panel)).toEqual({});
  });

  it("Backspace unbinds a default binding", () => {
    const panel = createShortcutsPanel();
    document.body.appendChild(panel);
    chip(panel, "workbench.action.quickOpen").click();
    const capture = panel.querySelector<HTMLInputElement>(".kb-capture")!;

    pressKey(capture, { key: "Backspace" });
    expect(capture.value).toBe("Unbound");
    pressKey(capture, { key: "Enter" });

    expect(chip(panel, "workbench.action.quickOpen").textContent).toBe("Unbound");
    expect(collectShortcutsSettings(panel)).toEqual({
      keybindings: { "workbench.action.quickOpen": "" },
    });
  });

  it("refresh discards pending edits back to the stored config", () => {
    const panel = createShortcutsPanel();
    document.body.appendChild(panel);
    chip(panel, "workbench.action.terminal.clear").click();
    const capture = panel.querySelector<HTMLElement>(".kb-capture")!;
    pressKey(capture, { key: "l", ctrlKey: true });
    pressKey(capture, { key: "Enter" });
    expect(chip(panel, "workbench.action.terminal.clear").textContent).toBe("Ctrl+L");

    // Revert path: pending edits are dropped, store (unbound) wins.
    refreshShortcutsPanel(document.body);
    expect(chip(panel, "workbench.action.terminal.clear").textContent).toBe("Unbound");
    expect(collectShortcutsSettings(panel)).toEqual({});
  });

  it("collect returns nothing when nothing changed", () => {
    const panel = createShortcutsPanel();
    expect(collectShortcutsSettings(panel)).toEqual({});
  });

  it("search filters rows by title and binding", () => {
    const panel = createShortcutsPanel();
    const search = panel.querySelector<HTMLInputElement>("#kb-search")!;
    search.value = "zen";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    const visible = [...panel.querySelectorAll<HTMLElement>(".kb-row[data-command]")];
    expect(visible.length).toBeGreaterThanOrEqual(1);
    expect(visible.every(r => r.dataset.command === "workbench.action.toggleZenMode")).toBe(true);
  });
});
