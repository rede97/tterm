import type { ITheme } from "@xterm/xterm";

export interface ThemeDef {
  name: string;
  label: string;
  theme: ITheme;
  source: "builtin" | "wt";
}

export const DEFAULT_THEME_NAME = "TTerm Dark";

function def(name: string, theme: ITheme): ThemeDef {
  return { name, label: name, theme, source: "builtin" };
}

// Curated popular open-source schemes (Solarized/Dracula/Nord/Gruvbox/OneHalf/Monokai — MIT).
export const BUILTIN_THEMES: ThemeDef[] = [
  def("TTerm Dark", {
    background: "#1e1e1e", foreground: "#d4d4d4", cursor: "#ffffff", selectionBackground: "#264f78",
    black: "#000000", red: "#cd3131", green: "#0dbc79", yellow: "#e5e510",
    blue: "#2472c8", magenta: "#bc3fbc", cyan: "#11a8cd", white: "#e5e5e5",
    brightBlack: "#666666", brightRed: "#f14c4c", brightGreen: "#23d18b", brightYellow: "#f5f543",
    brightBlue: "#3b8eea", brightMagenta: "#d670d6", brightCyan: "#29b8db", brightWhite: "#ffffff",
  }),
  def("Campbell", {
    background: "#0c0c0c", foreground: "#cccccc", cursor: "#ffffff", selectionBackground: "#3a3a3a",
    black: "#0c0c0c", red: "#c50f1f", green: "#13a10e", yellow: "#c19c00",
    blue: "#0037da", magenta: "#881798", cyan: "#3a96dd", white: "#cccccc",
    brightBlack: "#767676", brightRed: "#e74856", brightGreen: "#16c60c", brightYellow: "#f9f1a5",
    brightBlue: "#3b78ff", brightMagenta: "#b4009e", brightCyan: "#61d6d6", brightWhite: "#f2f2f2",
  }),
  def("Solarized Dark", {
    background: "#002b36", foreground: "#839496", cursor: "#93a1a1", selectionBackground: "#073642",
    black: "#073642", red: "#dc322f", green: "#859900", yellow: "#b58900",
    blue: "#268bd2", magenta: "#d33682", cyan: "#2aa198", white: "#eee8d5",
    brightBlack: "#002b36", brightRed: "#cb4b16", brightGreen: "#586e75", brightYellow: "#657b83",
    brightBlue: "#839496", brightMagenta: "#6c71c4", brightCyan: "#93a1a1", brightWhite: "#fdf6e3",
  }),
  def("Solarized Light", {
    background: "#fdf6e3", foreground: "#657b83", cursor: "#586e75", selectionBackground: "#eee8d5",
    black: "#073642", red: "#dc322f", green: "#859900", yellow: "#b58900",
    blue: "#268bd2", magenta: "#d33682", cyan: "#2aa198", white: "#eee8d5",
    brightBlack: "#002b36", brightRed: "#cb4b16", brightGreen: "#586e75", brightYellow: "#657b83",
    brightBlue: "#839496", brightMagenta: "#6c71c4", brightCyan: "#93a1a1", brightWhite: "#fdf6e3",
  }),
  def("One Half Dark", {
    background: "#282c34", foreground: "#dcdfe4", cursor: "#a3b3cc", selectionBackground: "#3e4451",
    black: "#282c34", red: "#e06c75", green: "#98c379", yellow: "#e5c07b",
    blue: "#61afef", magenta: "#c678dd", cyan: "#56b6c2", white: "#dcdfe4",
    brightBlack: "#5a6374", brightRed: "#e06c75", brightGreen: "#98c379", brightYellow: "#e5c07b",
    brightBlue: "#61afef", brightMagenta: "#c678dd", brightCyan: "#56b6c2", brightWhite: "#dcdfe4",
  }),
  def("One Half Light", {
    background: "#fafafa", foreground: "#383a42", cursor: "#4f525e", selectionBackground: "#e5e5e6",
    black: "#383a42", red: "#e45649", green: "#50a14f", yellow: "#c18401",
    blue: "#0184bc", magenta: "#a626a4", cyan: "#0997b3", white: "#fafafa",
    brightBlack: "#4f525e", brightRed: "#e45649", brightGreen: "#50a14f", brightYellow: "#c18401",
    brightBlue: "#0184bc", brightMagenta: "#a626a4", brightCyan: "#0997b3", brightWhite: "#ffffff",
  }),
  def("Dracula", {
    background: "#282a36", foreground: "#f8f8f2", cursor: "#f8f8f2", selectionBackground: "#44475a",
    black: "#21222c", red: "#ff5555", green: "#50fa7b", yellow: "#f1fa8c",
    blue: "#bd93f9", magenta: "#ff79c6", cyan: "#8be9fd", white: "#f8f8f2",
    brightBlack: "#6272a4", brightRed: "#ff6e6e", brightGreen: "#69ff94", brightYellow: "#ffffa5",
    brightBlue: "#d6acff", brightMagenta: "#ff92df", brightCyan: "#a4ffff", brightWhite: "#ffffff",
  }),
  def("Nord", {
    background: "#2e3440", foreground: "#d8dee9", cursor: "#d8dee9", selectionBackground: "#434c5e",
    black: "#3b4252", red: "#bf616a", green: "#a3be8c", yellow: "#ebcb8b",
    blue: "#81a1c1", magenta: "#b48ead", cyan: "#88c0d0", white: "#e5e9f0",
    brightBlack: "#4c566a", brightRed: "#bf616a", brightGreen: "#a3be8c", brightYellow: "#ebcb8b",
    brightBlue: "#81a1c1", brightMagenta: "#b48ead", brightCyan: "#8fbcbb", brightWhite: "#eceff4",
  }),
  def("Gruvbox Dark", {
    background: "#282828", foreground: "#ebdbb2", cursor: "#ebdbb2", selectionBackground: "#504945",
    black: "#282828", red: "#cc241d", green: "#98971a", yellow: "#d79921",
    blue: "#458588", magenta: "#b16286", cyan: "#689d6a", white: "#a89984",
    brightBlack: "#928374", brightRed: "#fb4934", brightGreen: "#b8bb26", brightYellow: "#fabd2f",
    brightBlue: "#83a598", brightMagenta: "#d3869b", brightCyan: "#8ec07c", brightWhite: "#ebdbb2",
  }),
  def("Monokai", {
    background: "#272822", foreground: "#f8f8f2", cursor: "#f8f8f2", selectionBackground: "#49483e",
    black: "#272822", red: "#f92672", green: "#a6e22e", yellow: "#f4bf75",
    blue: "#66d9ef", magenta: "#ae81ff", cyan: "#a1efe4", white: "#f8f8f2",
    brightBlack: "#75715e", brightRed: "#f92672", brightGreen: "#a6e22e", brightYellow: "#f4bf75",
    brightBlue: "#66d9ef", brightMagenta: "#ae81ff", brightCyan: "#a1efe4", brightWhite: "#f9f8f5",
  }),
  def("Tango Dark", {
    background: "#2e3436", foreground: "#d3d7cf", cursor: "#d3d7cf", selectionBackground: "#555753",
    black: "#2e3436", red: "#cc0000", green: "#4e9a06", yellow: "#c4a000",
    blue: "#3465a4", magenta: "#75507b", cyan: "#06989a", white: "#d3d7cf",
    brightBlack: "#555753", brightRed: "#ef2929", brightGreen: "#8ae234", brightYellow: "#fce94f",
    brightBlue: "#729fcf", brightMagenta: "#ad7fa8", brightCyan: "#34e2e2", brightWhite: "#eeeeec",
  }),
  def("Tokyo Night", {
    background: "#1a1b26", foreground: "#c0caf5", cursor: "#c0caf5", selectionBackground: "#33467c",
    black: "#15161e", red: "#f7768e", green: "#9ece6a", yellow: "#e0af68",
    blue: "#7aa2f7", magenta: "#bb9af7", cyan: "#7dcfff", white: "#a9b1d6",
    brightBlack: "#414868", brightRed: "#f7768e", brightGreen: "#9ece6a", brightYellow: "#e0af68",
    brightBlue: "#7aa2f7", brightMagenta: "#bb9af7", brightCyan: "#7dcfff", brightWhite: "#c0caf5",
  }),
];

// -- Windows Terminal schemes (imported from settings.json) --

let wtThemes: ThemeDef[] = [];

export function setWtThemes(themes: ThemeDef[]) {
  wtThemes = themes;
}

export function allThemes(): ThemeDef[] {
  return [...BUILTIN_THEMES, ...wtThemes];
}

export function findTheme(name: string | null | undefined): ThemeDef {
  if (name) {
    const hit = allThemes().find(t => t.name === name);
    if (hit) return hit;
  }
  return BUILTIN_THEMES[0];
}

// Parse the "schemes" array from WT settings.json raw content.
// WT fields map 1:1 to ITheme except cursorColor -> cursor.
export function parseWtSchemes(raw: string): ThemeDef[] {
  let root: any;
  try {
    root = JSON.parse(raw);
  } catch {
    return [];
  }
  const schemes: any[] = root?.schemes;
  if (!Array.isArray(schemes)) return [];

  const result: ThemeDef[] = [];
  for (const s of schemes) {
    if (!s || typeof s.name !== "string" || !s.name) continue;
    if (typeof s.background !== "string" || typeof s.foreground !== "string") continue;
    // Skip schemes that duplicate a built-in name (built-in wins)
    if (BUILTIN_THEMES.some(b => b.name === s.name)) continue;
    result.push({
      name: s.name,
      label: s.name,
      source: "wt",
      theme: {
        background: s.background,
        foreground: s.foreground,
        cursor: s.cursorColor,
        selectionBackground: s.selectionBackground,
        black: s.black, red: s.red, green: s.green, yellow: s.yellow,
        blue: s.blue, magenta: s.purple ?? s.magenta, cyan: s.cyan, white: s.white,
        brightBlack: s.brightBlack, brightRed: s.brightRed, brightGreen: s.brightGreen,
        brightYellow: s.brightYellow, brightBlue: s.brightBlue,
        brightMagenta: s.brightPurple ?? s.brightMagenta, brightCyan: s.brightCyan,
        brightWhite: s.brightWhite,
      },
    });
  }
  return result;
}
