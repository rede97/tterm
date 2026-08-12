import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import {
  comboFromEvent,
  parseCombo,
  comboMatches,
  formatCombo,
  defaultKeybindings,
  resolveKeybindings,
  findConflict,
  initKeymap,
  suspendKeymap,
  resumeKeymap,
  KEY_COMMANDS,
} from "../src/core/keymap";
import { configStore } from "../src/core/store";
import { filterSwitcherItems, stepIndex, type SwitcherItem } from "../src/ui/tabswitcher";

function keyEvent(init: Partial<KeyboardEventInit> & { key: string }): KeyboardEvent {
  return new KeyboardEvent("keydown", {
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    ...init,
  });
}

describe("comboFromEvent", () => {
  it("builds canonical combos with modifiers in fixed order", () => {
    expect(comboFromEvent(keyEvent({ key: "p", ctrlKey: true }))).toBe("ctrl+p");
    expect(comboFromEvent(keyEvent({ key: "P", ctrlKey: true, shiftKey: true }))).toBe("ctrl+shift+p");
    expect(comboFromEvent(keyEvent({ key: "Tab", ctrlKey: true }))).toBe("ctrl+tab");
    expect(comboFromEvent(keyEvent({ key: "F11" }))).toBe("f11");
    expect(comboFromEvent(keyEvent({ key: " ", ctrlKey: true }))).toBe("ctrl+space");
  });

  it("returns null for modifier-only presses", () => {
    expect(comboFromEvent(keyEvent({ key: "Control", ctrlKey: true }))).toBeNull();
    expect(comboFromEvent(keyEvent({ key: "Shift", shiftKey: true }))).toBeNull();
    expect(comboFromEvent(keyEvent({ key: "Alt", altKey: true }))).toBeNull();
  });
});

describe("parseCombo / comboMatches", () => {
  it("round-trips canonical combos", () => {
    expect(parseCombo("ctrl+shift+tab")).toEqual({ ctrl: true, alt: false, shift: true, meta: false, key: "tab" });
    expect(parseCombo("f11")).toEqual({ ctrl: false, alt: false, shift: false, meta: false, key: "f11" });
  });

  it("rejects malformed combos", () => {
    expect(parseCombo("")).toBeNull();
    expect(parseCombo("ctrl")).toBeNull();
    expect(parseCombo("ctrl+")).toBeNull();
    expect(parseCombo("bogus+p")).toBeNull();
  });

  it("matches only exact modifier state", () => {
    expect(comboMatches(keyEvent({ key: "Tab", ctrlKey: true }), "ctrl+tab")).toBe(true);
    // Ctrl+Shift+Tab must NOT match the plain Ctrl+Tab binding (this is what
    // keeps forward and reverse cycling distinct).
    expect(comboMatches(keyEvent({ key: "Tab", ctrlKey: true, shiftKey: true }), "ctrl+tab")).toBe(false);
    expect(comboMatches(keyEvent({ key: "Tab", ctrlKey: true, shiftKey: true }), "ctrl+shift+tab")).toBe(true);
    expect(comboMatches(keyEvent({ key: "w", ctrlKey: true }), "ctrl+w")).toBe(true);
    expect(comboMatches(keyEvent({ key: "w" }), "ctrl+w")).toBe(false);
  });
});

describe("formatCombo", () => {
  it("renders display form", () => {
    expect(formatCombo("ctrl+shift+p")).toBe("Ctrl+Shift+P");
    expect(formatCombo("f11")).toBe("F11");
    expect(formatCombo("ctrl+tab")).toBe("Ctrl+Tab");
    expect(formatCombo("")).toBe("");
  });
});

describe("resolveKeybindings", () => {
  it("falls back to registry defaults", () => {
    const resolved = resolveKeybindings({});
    expect(resolved).toEqual(defaultKeybindings());
    expect(resolved["workbench.action.quickOpen"]).toBe("ctrl+p");
  });

  it("applies user overrides, including explicit unbind", () => {
    const resolved = resolveKeybindings({
      "workbench.action.terminal.clear": "ctrl+l",
      "workbench.action.closeTab": "",
    });
    expect(resolved["workbench.action.terminal.clear"]).toBe("ctrl+l");
    expect(resolved["workbench.action.closeTab"]).toBe("");
  });

  it("drops ids that are not in the registry", () => {
    const resolved = resolveKeybindings({ "not.a.command": "ctrl+x" });
    expect("not.a.command" in resolved).toBe(false);
  });

  it("clear terminal ships unbound by default", () => {
    expect(defaultKeybindings()["workbench.action.terminal.clear"]).toBe("");
  });
});

describe("findConflict", () => {
  it("detects a combo already bound elsewhere", () => {
    const bindings = resolveKeybindings({});
    expect(findConflict(bindings, "ctrl+p", "workbench.action.closeTab")).toBe("workbench.action.quickOpen");
    expect(findConflict(bindings, "ctrl+p", "workbench.action.quickOpen")).toBeNull();
    expect(findConflict(bindings, "ctrl+alt+9", "workbench.action.quickOpen")).toBeNull();
    // Empty combo (unbind) never conflicts.
    expect(findConflict(bindings, "", "workbench.action.quickOpen")).toBeNull();
  });
});

describe("keymap dispatcher", () => {
  const fired: string[] = [];

  beforeAll(() => {
    // A Proxy stands in for the handler table so every command id resolves.
    initKeymap(new Proxy({}, { get: (_, id) => () => fired.push(String(id)) }) as never);
  });

  beforeEach(() => {
    fired.length = 0;
    configStore.set({ keybindings: {} });
  });

  function dispatch(init: Parameters<typeof keyEvent>[0]): KeyboardEvent {
    const e = keyEvent({ bubbles: true, cancelable: true, ...init });
    window.dispatchEvent(e);
    return e;
  }

  it("fires the bound command and swallows the event before the terminal sees it", () => {
    const e = dispatch({ key: "w", ctrlKey: true });
    expect(fired).toEqual(["workbench.action.closeTab"]);
    expect(e.defaultPrevented).toBe(true);
  });

  it("ignores unbound keys", () => {
    dispatch({ key: "d", ctrlKey: true });
    expect(fired).toEqual([]);
  });

  it("distinguishes ctrl+tab from ctrl+shift+tab", () => {
    dispatch({ key: "Tab", ctrlKey: true });
    dispatch({ key: "Tab", ctrlKey: true, shiftKey: true });
    expect(fired).toEqual(["workbench.action.nextTab", "workbench.action.prevTab"]);
  });

  it("follows rebinding and unbinding from config", () => {
    configStore.set({ keybindings: { "workbench.action.terminal.clear": "ctrl+l" } });
    dispatch({ key: "l", ctrlKey: true });
    expect(fired).toEqual(["workbench.action.terminal.clear"]);

    configStore.set({ keybindings: { "workbench.action.closeTab": "" } });
    dispatch({ key: "w", ctrlKey: true });
    expect(fired).toEqual(["workbench.action.terminal.clear"]);
  });

  it("stays quiet while suspended (settings capture input)", () => {
    suspendKeymap();
    try {
      dispatch({ key: "w", ctrlKey: true });
      expect(fired).toEqual([]);
    } finally {
      resumeKeymap();
    }
    dispatch({ key: "w", ctrlKey: true });
    expect(fired).toEqual(["workbench.action.closeTab"]);
  });
});

describe("filterSwitcherItems (Ctrl+P quick open)", () => {
  const items: SwitcherItem[] = [
    { id: "tab-1", label: "Terminal", index: 1, active: true, disconnected: false },
    { id: "tab-2", label: "prod-server", index: 2, active: false, disconnected: false },
    { id: "tab-3", label: "COM3 · 115200", index: 3, active: false, disconnected: true },
  ];

  it("empty query returns everything", () => {
    expect(filterSwitcherItems(items, "")).toHaveLength(3);
    expect(filterSwitcherItems(items, "   ")).toHaveLength(3);
  });

  it("numeric query matches the tab number", () => {
    expect(filterSwitcherItems(items, "2").map(i => i.id)).toEqual(["tab-2"]);
  });

  it("text query matches the label case-insensitively", () => {
    expect(filterSwitcherItems(items, "PROD").map(i => i.id)).toEqual(["tab-2"]);
    expect(filterSwitcherItems(items, "com3").map(i => i.id)).toEqual(["tab-3"]);
  });

  it("no match yields an empty list", () => {
    expect(filterSwitcherItems(items, "zzz")).toEqual([]);
  });
});

describe("stepIndex (MRU highlight)", () => {
  it("wraps forward and backward", () => {
    expect(stepIndex(0, 1, 4)).toBe(1);
    expect(stepIndex(3, 1, 4)).toBe(0);
    expect(stepIndex(0, -1, 4)).toBe(3);
    expect(stepIndex(1, -1, 4)).toBe(0);
  });

  it("first-press start: next tab vs wrap to least-recent", () => {
    // Ctrl+Tab opens on the next MRU entry; Ctrl+Shift+Tab on the last one.
    expect(stepIndex(0, 1, 3)).toBe(1);
    expect(stepIndex(0, -1, 3)).toBe(2);
  });

  it("degenerates safely", () => {
    expect(stepIndex(0, 1, 0)).toBe(0);
    expect(stepIndex(5, 1, 1)).toBe(0);
  });
});

describe("command registry", () => {
  it("has unique ids and a default entry for every command", () => {
    const ids = KEY_COMMANDS.map(c => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    const defaults = defaultKeybindings();
    for (const id of ids) expect(id in defaults).toBe(true);
  });

  it("F11 is browser-style full screen; Shift+F11 is the maximize variant", () => {
    const defaults = defaultKeybindings();
    expect(defaults["workbench.action.toggleFullScreen"]).toBe("f11");
    expect(defaults["workbench.action.toggleZenMode"]).toBe("shift+f11");
  });
});
