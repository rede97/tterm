import { describe, it, expect, beforeEach } from "vitest";
import {
  BUILTIN_THEMES, DEFAULT_THEME_NAME, findTheme, allThemes,
  parseWtSchemes, setWtThemes,
} from "../src/util/themes";

const ANSI_KEYS = [
  "black", "red", "green", "yellow", "blue", "magenta", "cyan", "white",
  "brightBlack", "brightRed", "brightGreen", "brightYellow",
  "brightBlue", "brightMagenta", "brightCyan", "brightWhite",
] as const;

describe("built-in themes", () => {
  it("have unique names", () => {
    const names = BUILTIN_THEMES.map(t => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("include the default theme", () => {
    expect(BUILTIN_THEMES.some(t => t.name === DEFAULT_THEME_NAME)).toBe(true);
  });

  it("every theme defines background, foreground and all 16 ANSI colors", () => {
    for (const t of BUILTIN_THEMES) {
      expect(t.theme.background, `${t.name}.background`).toMatch(/^#[0-9a-f]{6}$/i);
      expect(t.theme.foreground, `${t.name}.foreground`).toMatch(/^#[0-9a-f]{6}$/i);
      for (const key of ANSI_KEYS) {
        expect(t.theme[key], `${t.name}.${key}`).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });

  it("includes both dark and light schemes", () => {
    expect(BUILTIN_THEMES.some(t => t.name.includes("Light"))).toBe(true);
  });
});

describe("findTheme", () => {
  beforeEach(() => setWtThemes([]));

  it("finds a built-in theme by name", () => {
    expect(findTheme("Dracula").name).toBe("Dracula");
  });

  it("falls back to default for unknown or empty names", () => {
    expect(findTheme("No Such Theme").name).toBe(DEFAULT_THEME_NAME);
    expect(findTheme(null).name).toBe(DEFAULT_THEME_NAME);
    expect(findTheme(undefined).name).toBe(DEFAULT_THEME_NAME);
  });
});

describe("parseWtSchemes (Windows Terminal import)", () => {
  beforeEach(() => setWtThemes([]));

  const WT_SETTINGS = JSON.stringify({
    schemes: [
      {
        name: "My Custom",
        background: "#101010", foreground: "#eeeeee",
        cursorColor: "#00ff00", selectionBackground: "#333333",
        black: "#000000", red: "#ff0000", green: "#00ff00", yellow: "#ffff00",
        blue: "#0000ff", purple: "#ff00ff", cyan: "#00ffff", white: "#ffffff",
        brightBlack: "#111111", brightRed: "#ff1111", brightGreen: "#11ff11",
        brightYellow: "#ffff11", brightBlue: "#1111ff", brightPurple: "#ff11ff",
        brightCyan: "#11ffff", brightWhite: "#ffffff",
      },
      // duplicates a built-in name -> skipped (built-in wins)
      { name: "Dracula", background: "#000000", foreground: "#ffffff" },
      // missing required fields -> skipped
      { name: "Broken", background: "#000000" },
    ],
  });

  it("parses valid schemes and maps WT field names", () => {
    const themes = parseWtSchemes(WT_SETTINGS);
    expect(themes).toHaveLength(1);
    const t = themes[0];
    expect(t.name).toBe("My Custom");
    expect(t.source).toBe("wt");
    expect(t.theme.cursor).toBe("#00ff00");          // cursorColor -> cursor
    expect(t.theme.magenta).toBe("#ff00ff");         // purple -> magenta
    expect(t.theme.brightMagenta).toBe("#ff11ff");   // brightPurple -> brightMagenta
  });

  it("skips duplicates of built-in names and malformed entries", () => {
    const themes = parseWtSchemes(WT_SETTINGS);
    expect(themes.some(t => t.name === "Dracula")).toBe(false);
    expect(themes.some(t => t.name === "Broken")).toBe(false);
  });

  it("returns empty array for invalid JSON or missing schemes", () => {
    expect(parseWtSchemes("not json")).toEqual([]);
    expect(parseWtSchemes("{}")).toEqual([]);
  });

  it("imported schemes become resolvable via findTheme", () => {
    setWtThemes(parseWtSchemes(WT_SETTINGS));
    expect(findTheme("My Custom").name).toBe("My Custom");
    expect(allThemes().length).toBe(BUILTIN_THEMES.length + 1);
    setWtThemes([]);
  });
});
