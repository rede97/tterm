// Runtime constants and utility functions — separated from types.ts
// to keep type definitions pure.

import type { SerialEnterNewline, SerialFrame, SerialOutputNewline, SshHost } from "./types";

// ---- Constants ----

export const SERIAL_BAUD_RATES = [9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600];

/** Classic 8-bit frames for new serial sessions (data / parity / stop). */
export const SERIAL_FRAMES: readonly (readonly [SerialFrame, string])[] = [
  ["8N1", "8N1"],
  ["8E1", "8E1"],
  ["8O1", "8O1"],
];

export const SERIAL_FRAME_DESCS: Record<SerialFrame, string> = {
  "8N1": "8 data bits, no parity, 1 stop bit",
  "8E1": "8 data bits, even parity, 1 stop bit",
  "8O1": "8 data bits, odd parity, 1 stop bit",
};

export function parseSerialFrame(frame: string): {
  dataBits: number;
  parity: "none" | "even" | "odd";
  stopBits: number;
} {
  switch (frame) {
    case "8E1":
      return { dataBits: 8, parity: "even", stopBits: 1 };
    case "8O1":
      return { dataBits: 8, parity: "odd", stopBits: 1 };
    default:
      return { dataBits: 8, parity: "none", stopBits: 1 };
  }
}

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
// Bare mapping notation mirrors src-tauri/src/newline.rs semantics.
export const SERIAL_OUTPUT_NEWLINE_DESCS: Record<SerialOutputNewline, string> = {
  keep: "Pass through unchanged",
  "cr-in-lf": "Lone \\n → \\r\\n",
  "lf-in-cr": "\\r → \\r\\n",
  "force-crlf": "\\r | \\n | \\r\\n → \\r\\n",
  "force-lf": "\\r | \\n | \\r\\n → \\n",
  "force-cr": "\\r | \\n | \\r\\n → \\r",
  strip: "\\r | \\n → (removed)",
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
