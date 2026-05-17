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

// Current font stack (ordered fallback list)
export let fontStack: string[] = ["JetBrains Mono", "Consolas", "monospace"];

// Build CSS font-family value from stack
export function buildFontFamily(fonts: string[]): string {
  return fonts.map(f => f.includes(" ") ? `'${f}'` : f).join(", ");
}

export function parseFontFamily(css: string): string[] {
  return css.split(",").map(s => s.trim().replace(/^['"]|['"]$/g, ""));
}

export function updateFontStack(stack: string[]) {
  fontStack = stack;
}

export function defaultFontStack(): string[] {
  return ["JetBrains Mono", "Consolas", "monospace"];
}
