import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  comboFromEvent,
  comboMatches,
  defaultKeybindings,
  findConflict,
  formatCombo,
  initKeymap,
  KEY_COMMANDS,
  parseCombo,
  resolveKeybindings,
  resumeKeymap,
  suspendKeymap,
} from "../src/core/keymap";
import { configStore } from "../src/core/store";

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
    expect(comboFromEvent(keyEvent({ key: "P", ctrlKey: true, shiftKey: true }))).toBe(
      "ctrl+shift+p",
    );
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
    expect(parseCombo("ctrl+shift+tab")).toEqual({
      ctrl: true,
      alt: false,
      shift: true,
      meta: false,
      key: "tab",
    });
    expect(parseCombo("f11")).toEqual({
      ctrl: false,
      alt: false,
      shift: false,
      meta: false,
      key: "f11",
    });
  });

  it("rejects malformed combos", () => {
    expect(parseCombo("")).toBeNull();
    expect(parseCombo("ctrl")).toBeNull();
    expect(parseCombo("ctrl+")).toBeNull();
    expect(parseCombo("bogus+p")).toBeNull();
  });

  it("the plus key itself round-trips (ctrl++)", () => {
    expect(parseCombo("ctrl++")).toEqual({
      ctrl: true,
      alt: false,
      shift: false,
      meta: false,
      key: "+",
    });
    expect(parseCombo("+")).toEqual({
      ctrl: false,
      alt: false,
      shift: false,
      meta: false,
      key: "+",
    });
    expect(comboFromEvent(keyEvent({ key: "+", ctrlKey: true }))).toBe("ctrl++");
    expect(comboMatches(keyEvent({ key: "+", ctrlKey: true }), "ctrl++")).toBe(true);
    expect(formatCombo("ctrl++")).toBe("Ctrl++");
  });

  it("numpad keys stay distinct from main-row twins", () => {
    expect(comboFromEvent(keyEvent({ key: "1", ctrlKey: true, code: "Numpad1" }))).toBe(
      "ctrl+num1",
    );
    expect(comboFromEvent(keyEvent({ key: "1", ctrlKey: true, code: "Digit1" }))).toBe("ctrl+1");
    expect(parseCombo("ctrl+num1")).toEqual({
      ctrl: true,
      alt: false,
      shift: false,
      meta: false,
      key: "num1",
    });
  });

  it("matches only exact modifier state", () => {
    expect(comboMatches(keyEvent({ key: "Tab", ctrlKey: true }), "ctrl+tab")).toBe(true);
    // Ctrl+Shift+Tab must NOT match the plain Ctrl+Tab binding (this is what
    // keeps forward and reverse cycling distinct).
    expect(comboMatches(keyEvent({ key: "Tab", ctrlKey: true, shiftKey: true }), "ctrl+tab")).toBe(
      false,
    );
    expect(
      comboMatches(keyEvent({ key: "Tab", ctrlKey: true, shiftKey: true }), "ctrl+shift+tab"),
    ).toBe(true);
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
    expect(findConflict(bindings, "ctrl+p", "workbench.action.closeTab")).toBe(
      "workbench.action.quickOpen",
    );
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

  it("Ctrl+Shift+P runs the command palette by default", () => {
    const e = dispatch({ key: "P", ctrlKey: true, shiftKey: true });
    expect(fired).toEqual(["workbench.action.showCommands"]);
    expect(e.defaultPrevented).toBe(true);
  });

  it("blocks WebView print (Ctrl+Shift+P) when the palette is unbound", () => {
    configStore.set({ keybindings: { "workbench.action.showCommands": "" } });
    const e = dispatch({ key: "P", ctrlKey: true, shiftKey: true });
    expect(fired).toEqual([]);
    expect(e.defaultPrevented).toBe(true);
  });

  it("still blocks print while keymap is suspended for capture", () => {
    suspendKeymap();
    try {
      const e = dispatch({ key: "P", ctrlKey: true, shiftKey: true });
      expect(fired).toEqual([]);
      expect(e.defaultPrevented).toBe(true);
    } finally {
      resumeKeymap();
    }
  });
});

describe("command registry", () => {
  it("has unique ids and a default entry for every command", () => {
    const ids = KEY_COMMANDS.map((c) => c.id);
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
