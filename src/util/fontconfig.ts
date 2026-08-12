export interface FontDef {
  family: string; // CSS font-family name
  label: string; // display name
  source: "builtin" | "system";
  importPath?: string; // Vite import path for builtin fonts
}

// Built-in fonts from @fontsource (no ligatures where possible).
// Nerd Fonts are deliberately NOT embedded: the patched builds age badly
// and ship incomplete glyph sets. Users install NF at the OS level — the
// system-font enumeration already lists them in the picker.
export const BUILTIN_FONTS: FontDef[] = [
  { family: "JetBrains Mono", label: "JetBrains Mono", source: "builtin" },
  { family: "Fira Mono", label: "Fira Mono", source: "builtin" },
  { family: "Cascadia Mono", label: "Cascadia Mono", source: "builtin" },
  { family: "Source Code Pro", label: "Source Code Pro", source: "builtin" },
  { family: "IBM Plex Mono", label: "IBM Plex Mono", source: "builtin" },
  { family: "Roboto Mono", label: "Roboto Mono", source: "builtin" },
  { family: "Ubuntu Mono", label: "Ubuntu Mono", source: "builtin" },
];

export function allBuiltinFonts(): FontDef[] {
  return BUILTIN_FONTS;
}

// Current font stack (ordered fallback list).
// "monospace" is implicit — always appended as the final fallback, never stored or displayed.
export let fontStack: string[] = [
  "JetBrains Mono",
  "Noto Sans SC",
  "Noto Sans JP",
  "Noto Sans KR",
  "Consolas",
];

// Build CSS font-family value from stack. Always appends "monospace" as final fallback.
export function buildFontFamily(fonts: string[]): string {
  const stack = fonts.filter((f) => f.toLowerCase() !== "monospace");
  stack.push("monospace");
  return stack.map((f) => (f.includes(" ") ? `'${f}'` : f)).join(", ");
}

export function parseFontFamily(css: string): string[] {
  // Split on commas OUTSIDE quotes — a quoted family may itself contain a
  // comma ("'Foo, Bar', monospace"). Quotes are consumed by the split.
  const parts: string[] = [];
  let cur = "";
  let quote: string | null = null;
  for (const ch of css) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
    } else if (ch === ",") {
      parts.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  parts.push(cur);
  return parts.map((s) => s.trim()).filter((f) => f && f.toLowerCase() !== "monospace");
}

export function updateFontStack(stack: string[]) {
  fontStack = stack.filter((f) => f.toLowerCase() !== "monospace");
}

export function defaultFontStack(): string[] {
  return ["JetBrains Mono", "Noto Sans SC", "Noto Sans JP", "Noto Sans KR", "Consolas"];
}

// -- System font enumeration ---

let _systemFonts: string[] = [];

export function setSystemFonts(fonts: string[]) {
  _systemFonts = fonts;
}

export function systemFontDefs(): FontDef[] {
  const builtinFamilies = new Set(BUILTIN_FONTS.map((f) => f.family.toLowerCase()));
  return _systemFonts
    .filter((name) => !builtinFamilies.has(name.toLowerCase()))
    .map((name) => ({ family: name, label: name, source: "system" as const }));
}
