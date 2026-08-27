import { readFileSync } from "node:fs";
import { join } from "node:path";
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

function cssCustomProp(src: string, name: string): string {
  const re = new RegExp(`^[ \\t]*${name.replace(/-/g, "\\-")}:\\s*([^;]+);`, "ms");
  const m = src.match(re);
  if (!m) throw new Error(`CSS custom property ${name} not found`);
  return m[1].replace(/\s+/g, " ").trim();
}

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

describe("chrome --tt-ui / --tt-mono CJK (tokens.css)", () => {
  const tokens = readFileSync(join(__dirname, "../src/ui/tokens.css"), "utf8");
  const styles = readFileSync(join(__dirname, "../src/styles.css"), "utf8");

  it("--tt-mono lists JetBrains then the same CJK families as defaultFontStack, plus YaHei before generic monospace", () => {
    const mono = cssCustomProp(tokens, "--tt-mono");
    expect(mono.startsWith('"JetBrains Mono", Consolas')).toBe(true);
    for (const family of ["Noto Sans SC", "Noto Sans JP", "Noto Sans KR"]) {
      expect(mono).toContain(`"${family}"`);
      expect(defaultFontStack()).toContain(family);
    }
    const yahei = mono.indexOf('"Microsoft YaHei UI"');
    const generic = mono.indexOf("ui-monospace");
    expect(yahei).toBeGreaterThan(-1);
    expect(mono).toContain('"Microsoft YaHei"');
    expect(generic).toBeGreaterThan(yahei);
    expect(mono.endsWith("ui-monospace, monospace")).toBe(true);
  });

  it("--tt-ui lists YaHei after Segoe so Settings CJK stays sans (not SimSun)", () => {
    const ui = cssCustomProp(tokens, "--tt-ui");
    expect(ui.startsWith('Inter, "Segoe UI", "Microsoft YaHei UI"')).toBe(true);
    expect(ui.endsWith("system-ui, sans-serif")).toBe(true);
  });

  it("tab chrome and the new-tab profile ▾ use --tt-mono, not --tt-ui", () => {
    expect(styles).toMatch(/\.tab \{[\s\S]*?font-family:\s*var\(--tt-mono\)/);
    expect(styles).toMatch(/\.profile-menu \{[\s\S]*?font-family:\s*var\(--tt-mono\)/);
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
