// Custom color themes — persisted in their OWN file (themes.json in the app
// config dir), NOT the main config.json. Rust does raw file I/O
// (read_themes/write_themes); parsing/validation lives here.

import { invoke } from "@tauri-apps/api/core";
import type { ITheme } from "@xterm/xterm";
import { logError } from "../core/errorlog";
import { allThemes, setCustomThemes, type ThemeDef } from "../util/themes";

// The 21 editable colors, in editor display order.
export const THEME_COLOR_KEYS = [
  "background",
  "foreground",
  "cursor",
  "cursorAccent",
  "selectionBackground",
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

export type ThemeColorKey = (typeof THEME_COLOR_KEYS)[number];

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/** Keep only known keys with valid #rrggbb values; drop everything else. */
export function sanitizeTheme(raw: unknown): ITheme | null {
  if (typeof raw !== "object" || raw === null) return null;
  const out: Record<string, string> = {};
  for (const key of THEME_COLOR_KEYS) {
    const v = (raw as Record<string, unknown>)[key];
    if (typeof v === "string" && HEX_RE.test(v)) out[key] = v;
  }
  // A theme without at least bg+fg is useless.
  if (!out.background || !out.foreground) return null;
  return out as ITheme;
}

/** Parse themes.json content; invalid entries are skipped, never fatal. */
export function parseCustomThemes(raw: string): ThemeDef[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: ThemeDef[] = [];
    for (const entry of parsed) {
      if (typeof entry !== "object" || entry === null) continue;
      const name = (entry as Record<string, unknown>).name;
      const theme = sanitizeTheme((entry as Record<string, unknown>).theme);
      if (typeof name === "string" && name.trim() && theme) {
        out.push({ name: name.trim(), label: name.trim(), theme, source: "custom" });
      }
    }
    return out;
  } catch (e) {
    logError("customThemes.parse", e);
    return [];
  }
}

export function serializeCustomThemes(themes: ThemeDef[]): string {
  return JSON.stringify(
    themes.map((t) => ({ name: t.name, theme: t.theme })),
    null,
    2,
  );
}

/** Load themes.json into the theme registry. Call once at startup. */
export async function loadCustomThemes(): Promise<ThemeDef[]> {
  const raw = await invoke<string>("read_themes");
  const themes = parseCustomThemes(raw);
  setCustomThemes(themes);
  return themes;
}

/** A theme name not taken by any builtin/WT/custom theme. */
export function dedupeThemeName(base: string): string {
  const taken = new Set(allThemes().map((t) => t.name));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base} ${i}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * Insert or replace a custom theme (match by `originalName` when renaming,
 * else by name) and persist themes.json. Returns the updated list.
 */
export async function saveCustomTheme(
  name: string,
  theme: ITheme,
  originalName?: string,
): Promise<ThemeDef[]> {
  const current = parseCustomThemes(await invoke<string>("read_themes"));
  const def: ThemeDef = { name, label: name, theme, source: "custom" };
  const idx = current.findIndex((t) => t.name === (originalName ?? name));
  if (idx >= 0) current.splice(idx, 1, def);
  else current.push(def);
  await invoke("write_themes", { content: serializeCustomThemes(current) });
  setCustomThemes(current);
  return current;
}

export async function deleteCustomTheme(name: string): Promise<ThemeDef[]> {
  const current = parseCustomThemes(await invoke<string>("read_themes")).filter(
    (t) => t.name !== name,
  );
  await invoke("write_themes", { content: serializeCustomThemes(current) });
  setCustomThemes(current);
  return current;
}
