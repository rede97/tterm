// Runtime constants and utility functions — separated from types.ts
// to keep type definitions pure.

import type { SerialEnterNewline, SerialOutputNewline, SshHost } from "./types";

// ---- Constants ----

export const SERIAL_BAUD_RATES = [9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600];

export const SERIAL_ENTER_NEWLINES: [SerialEnterNewline, string][] = [
  ["cr", "CR (\\r)"],
  ["lf", "LF (\\n)"],
  ["crlf", "CRLF (\\r\\n)"],
];

export const SERIAL_OUTPUT_NEWLINES: [SerialOutputNewline, string][] = [
  ["keep", "Keep (raw)"],
  ["cr-in-lf", "Implicit CR in every LF"],
  ["lf-in-cr", "Implicit LF in every CR"],
  ["force-crlf", "Force CRLF"],
  ["force-lf", "Force LF"],
  ["force-cr", "Force CR"],
  ["strip", "Strip"],
];

// One-line help per output-newline mode, shown in the profile editor.
// Semantics mirror src-tauri/src/newline.rs.
export const SERIAL_OUTPUT_NEWLINE_DESCS: Record<SerialOutputNewline, string> = {
  keep: "Pass through unchanged — the device already sends CRLF (most MCU/AT firmware).",
  "cr-in-lf":
    "Lone LF becomes CRLF (pairs untouched) — fixes staircase output from LF-only devices.",
  "lf-in-cr":
    "Every CR gains an LF — fixes line-overwrite from CR-only devices; CRLF pairs gain a blank line.",
  "force-crlf":
    "Normalize every ending (lone CR / lone LF / CRLF) to CRLF — tidiest for mixed-ending devices.",
  "force-lf": "Normalize every ending to LF — for logging into Unix tools that split lines on LF.",
  "force-cr": "Normalize every ending to CR — legacy compatibility fallback, rarely needed.",
  strip: "Remove all CR/LF — single-line protocols that redraw in place, or binary streams.",
};

// ---- Utility functions ----

/** HTML-escape for values interpolated into innerHTML templates. */
export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function hostProp(h: SshHost, key: string): string | undefined {
  if (h[key] !== undefined) return h[key];
  const lower = key.toLowerCase();
  for (const k of Object.keys(h)) {
    if (k.toLowerCase() === lower) return h[k];
  }
  return undefined;
}

export function trimPasteContent(text: string, trim: boolean): string {
  if (!trim) return text;
  return text
    .trim()
    .split("\n")
    .filter((line) => line.trim() !== "")
    .join("\n");
}
