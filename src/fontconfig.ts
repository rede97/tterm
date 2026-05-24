export interface FontDef {
  family: string;       // CSS font-family name
  label: string;        // display name
  source: "builtin" | "nerdfont" | "system";
  importPath?: string;  // Vite import path for builtin fonts
}

// Built-in fonts from @fontsource (no ligatures where possible)
export const BUILTIN_FONTS: FontDef[] = [
  { family: "JetBrains Mono", label: "JetBrains Mono", source: "builtin" },
  { family: "Fira Mono", label: "Fira Mono", source: "builtin" },
  { family: "Cascadia Mono", label: "Cascadia Mono", source: "builtin" },
  { family: "Source Code Pro", label: "Source Code Pro", source: "builtin" },
  { family: "IBM Plex Mono", label: "IBM Plex Mono", source: "builtin" },
  { family: "Roboto Mono", label: "Roboto Mono", source: "builtin" },
  { family: "Ubuntu Mono", label: "Ubuntu Mono", source: "builtin" },
];

// Built-in Nerd Font patched fonts
export const NERDFONT_BUILTIN: FontDef[] = [
  { family: "DroidSansMono NF", label: "DroidSansMono NF", source: "nerdfont" },
  { family: "UbuntuMono NF", label: "UbuntuMono NF", source: "nerdfont" },
];

export function allBuiltinFonts(): FontDef[] {
  return [...BUILTIN_FONTS, ...NERDFONT_BUILTIN];
}

// Current font stack (ordered fallback list).
// "monospace" is implicit — always appended as the final fallback, never stored or displayed.
export let fontStack: string[] = ["JetBrains Mono", "Noto Sans SC", "Noto Sans JP", "Noto Sans KR", "Consolas"];

// Build CSS font-family value from stack. Always appends "monospace" as final fallback.
export function buildFontFamily(fonts: string[]): string {
  const stack = fonts.filter(f => f.toLowerCase() !== "monospace");
  stack.push("monospace");
  return stack.map(f => f.includes(" ") ? `'${f}'` : f).join(", ");
}

export function parseFontFamily(css: string): string[] {
  return css.split(",").map(s => s.trim().replace(/^['"]|['"]$/g, ""))
    .filter(f => f.toLowerCase() !== "monospace");
}

export function updateFontStack(stack: string[]) {
  fontStack = stack.filter(f => f.toLowerCase() !== "monospace");
}

export function defaultFontStack(): string[] {
  return ["JetBrains Mono", "Noto Sans SC", "Noto Sans JP", "Noto Sans KR", "Consolas"];
}

// -- System font enumeration ---

let _systemFonts: string[] = [];
let _resolveSystemFonts: ((fonts: string[]) => void) | null = null;

export function setSystemFonts(fonts: string[]) {
  _systemFonts = fonts;
  if (_resolveSystemFonts) {
    _resolveSystemFonts(fonts);
    _resolveSystemFonts = null;
  }
}

export function systemFontDefs(): FontDef[] {
  const builtinFamilies = new Set(
    [...BUILTIN_FONTS, ...NERDFONT_BUILTIN].map(f => f.family.toLowerCase())
  );
  return _systemFonts
    .filter(name => !builtinFamilies.has(name.toLowerCase()))
    .map(name => ({ family: name, label: name, source: "system" as const }));
}
