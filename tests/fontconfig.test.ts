import { describe, expect, it } from "vitest";
import {
  allBuiltinFonts,
  BUILTIN_FONTS,
  buildFontFamily,
  defaultFontStack,
  fontStack,
  parseFontFamily,
  updateFontStack,
} from "../src/util/fontconfig";

describe("buildFontFamily", () => {
  it("quotes families containing spaces", () => {
    expect(buildFontFamily(["JetBrains Mono", "Consolas"])).toBe(
      "'JetBrains Mono', Consolas, monospace",
    );
  });

  it("always appends monospace as final fallback", () => {
    expect(buildFontFamily(["Consolas"])).toBe("Consolas, monospace");
  });

  it("never duplicates monospace even if present in input", () => {
    expect(buildFontFamily(["Consolas", "monospace"])).toBe("Consolas, monospace");
  });
});

describe("parseFontFamily", () => {
  it("strips quotes and the monospace fallback", () => {
    expect(parseFontFamily("'JetBrains Mono', Consolas, monospace")).toEqual([
      "JetBrains Mono",
      "Consolas",
    ]);
  });

  it("round-trips with buildFontFamily", () => {
    const stack = ["JetBrains Mono", "Noto Sans SC", "Cascadia Mono"];
    expect(parseFontFamily(buildFontFamily(stack))).toEqual(stack);
  });
});

describe("defaultFontStack / initial config consistency", () => {
  it("matches the module-level initial fontStack", () => {
    // guards against drift between defaultFontStack() and the initial value
    expect(fontStack).toEqual(defaultFontStack());
  });

  it("includes per-script CJK fallbacks (SC/JP/KR)", () => {
    const stack = defaultFontStack();
    expect(stack).toContain("Noto Sans SC");
    expect(stack).toContain("Noto Sans JP");
    expect(stack).toContain("Noto Sans KR");
  });
});

describe("updateFontStack", () => {
  it("filters out monospace entries", () => {
    updateFontStack(["Consolas", "monospace", "Courier New"]);
    expect(fontStack).toEqual(["Consolas", "Courier New"]);
    updateFontStack(defaultFontStack()); // restore
  });
});

describe("built-in font definitions", () => {
  it("have unique family names", () => {
    const all = BUILTIN_FONTS.map((f) => f.family.toLowerCase());
    expect(new Set(all).size).toBe(all.length);
  });

  it("embed no Nerd Fonts (users install NF at OS level)", () => {
    expect(allBuiltinFonts().every((f) => !/\bNF\b|nerd/i.test(f.family))).toBe(true);
  });
});

describe("parseFontFamily edge cases", () => {
  it("keeps quoted families containing commas intact", () => {
    expect(parseFontFamily("'Foo, Bar', Consolas")).toEqual(["Foo, Bar", "Consolas"]);
    // and round-trips through buildFontFamily
    const stack = parseFontFamily(buildFontFamily(["Foo, Bar", "Consolas"]));
    expect(stack).toEqual(["Foo, Bar", "Consolas"]);
  });
});
