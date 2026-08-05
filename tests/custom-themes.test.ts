import { describe, it, expect, vi, beforeEach } from "vitest";

// Fake themes.json backing store for read_themes/write_themes.
const { file } = vi.hoisted(() => ({ file: { content: "[]" } }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((cmd: string, args?: { content?: string }) => {
    if (cmd === "read_themes") return Promise.resolve(file.content);
    if (cmd === "write_themes") {
      file.content = args?.content ?? "[]";
      return Promise.resolve(null);
    }
    return Promise.resolve(null);
  }),
}));

import {
  parseCustomThemes,
  sanitizeTheme,
  dedupeThemeName,
  saveCustomTheme,
  deleteCustomTheme,
  loadCustomThemes,
} from "../src/config/custom-themes";
import { allThemes, findTheme } from "../src/util/themes";

const VALID = { background: "#102030", foreground: "#e0e0e0" };

beforeEach(() => {
  file.content = "[]";
  // loadCustomThemes re-reads the fake file and resets the registry.
  return loadCustomThemes().then(() => {});
});

describe("sanitizeTheme", () => {
  it("keeps valid colors, drops unknown keys and bad values", () => {
    const t = sanitizeTheme({
      ...VALID,
      red: "#ff0000",
      bogusKey: "#123456",
      blue: "red", // not hex
      brightBlue: "#12",
    });
    expect(t).toEqual({ ...VALID, red: "#ff0000" });
  });

  it("rejects themes without background or foreground", () => {
    expect(sanitizeTheme({ foreground: "#ffffff" })).toBeNull();
    expect(sanitizeTheme({ background: "#000000" })).toBeNull();
    expect(sanitizeTheme("nope")).toBeNull();
  });
});

describe("parseCustomThemes", () => {
  it("parses valid entries and skips invalid ones", () => {
    file.content = JSON.stringify([
      { name: "Mine", theme: VALID },
      { name: "", theme: VALID },            // empty name
      { name: "Broken", theme: { red: "#ff0000" } }, // no bg/fg
      "garbage",
    ]);
    const themes = parseCustomThemes(file.content);
    expect(themes.map((t) => t.name)).toEqual(["Mine"]);
    expect(themes[0].source).toBe("custom");
  });

  it("returns [] for malformed JSON instead of throwing", () => {
    expect(parseCustomThemes("{not json")).toEqual([]);
    expect(parseCustomThemes("{}")).toEqual([]);
  });
});

describe("dedupeThemeName", () => {
  it("returns the base when free, else appends a counter", () => {
    expect(dedupeThemeName("Brand New")).toBe("Brand New");
    // "TTerm Dark" is a builtin — collides.
    expect(dedupeThemeName("TTerm Dark")).toBe("TTerm Dark 2");
  });
});

describe("saveCustomTheme / deleteCustomTheme", () => {
  it("inserts a new theme and persists it to themes.json", async () => {
    await saveCustomTheme("Mine", VALID);
    expect(findTheme("Mine").theme).toEqual(VALID);
    const onDisk = JSON.parse(file.content);
    expect(onDisk).toHaveLength(1);
    expect(onDisk[0].name).toBe("Mine");
  });

  it("replaces in place when saving the same name (no duplicates)", async () => {
    await saveCustomTheme("Mine", VALID);
    await saveCustomTheme("Mine", { ...VALID, red: "#aa0000" });
    expect(JSON.parse(file.content)).toHaveLength(1);
    expect(findTheme("Mine").theme.red).toBe("#aa0000");
  });

  it("renames via originalName", async () => {
    await saveCustomTheme("Mine", VALID);
    await saveCustomTheme("Renamed", VALID, "Mine");
    const names = allThemes().filter((t) => t.source === "custom").map((t) => t.name);
    expect(names).toEqual(["Renamed"]);
  });

  it("deletes only the named theme", async () => {
    await saveCustomTheme("A", VALID);
    await saveCustomTheme("B", VALID);
    await deleteCustomTheme("A");
    const names = allThemes().filter((t) => t.source === "custom").map((t) => t.name);
    expect(names).toEqual(["B"]);
    expect(findTheme("A").name).toBe("TTerm Dark"); // falls back to default
  });
});
