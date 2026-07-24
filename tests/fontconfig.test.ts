import { describe, it, expect } from "vitest";
import {
  buildFontFamily, parseFontFamily, defaultFontStack,
  updateFontStack, fontStack, BUILTIN_FONTS, NERDFONT_BUILTIN,
} from "../src/util/fontconfig";

describe("buildFontFamily", () => {
  it("quotes families containing spaces", () => {
    expect(buildFontFamily(["JetBrains Mono", "Consolas"]))
      .toBe("'JetBrains Mono', Consolas, monospace");
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
    expect(parseFontFamily("'JetBrains Mono', Consolas, monospace"))
      .toEqual(["JetBrains Mono", "Consolas"]);
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
  it("have unique family names across builtin and nerdfont sets", () => {
    const all = [...BUILTIN_FONTS, ...NERDFONT_BUILTIN].map(f => f.family.toLowerCase());
    expect(new Set(all).size).toBe(all.length);
  });
});
