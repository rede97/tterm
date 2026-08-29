import { describe, expect, it } from "vitest";
import { allThemes, BUILTIN_THEMES, DEFAULT_THEME_NAME, findTheme } from "../src/util/themes";

const ANSI_KEYS = [
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
  "brightBlack",
  "brightRed",
  "brightGreen",
  "brightYellow",
  "brightBlue",
  "brightMagenta",
  "brightCyan",
  "brightWhite",
] as const;

describe("built-in themes", () => {
  it("have unique names", () => {
    const names = BUILTIN_THEMES.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("include the default theme", () => {
    expect(BUILTIN_THEMES.some((t) => t.name === DEFAULT_THEME_NAME)).toBe(true);
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
    expect(BUILTIN_THEMES.some((t) => t.name.includes("Light"))).toBe(true);
  });

  it("places Cursor Dark second, after TTerm Dark", () => {
    expect(BUILTIN_THEMES[0].name).toBe("TTerm Dark");
    expect(BUILTIN_THEMES[1].name).toBe("Cursor Dark");
    expect(BUILTIN_THEMES[1].theme.background).toBe("#141414");
    expect(BUILTIN_THEMES[1].theme.green).toBe("#3fa266");
    expect(BUILTIN_THEMES[1].theme.cyan).toBe("#88c0d0");
  });
});

describe("findTheme", () => {
  it("finds a built-in theme by name", () => {
    expect(findTheme("Dracula").name).toBe("Dracula");
    expect(findTheme("Cursor Dark").name).toBe("Cursor Dark");
  });

  it("falls back to default for unknown or empty names", () => {
    expect(findTheme("No Such Theme").name).toBe(DEFAULT_THEME_NAME);
    expect(findTheme(null).name).toBe(DEFAULT_THEME_NAME);
    expect(findTheme(undefined).name).toBe(DEFAULT_THEME_NAME);
  });

  it("allThemes is built-in then custom — no Windows Terminal import", () => {
    expect(allThemes().every((t) => t.source === "builtin" || t.source === "custom")).toBe(true);
    expect(allThemes().some((t) => t.name === "Dark+")).toBe(false);
  });
});
