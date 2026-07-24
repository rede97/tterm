// Shared type definitions — extracted from profiles.ts.
// This module has NO runtime dependencies (pure types + constants).

export type TabType = "local" | "ssh" | "serial";
export type SerialInputMode = "normal" | "echo" | "line";
export type SerialEnterNewline = "cr" | "lf" | "crlf";
export type SerialOutputNewline = "keep" | "cr-in-lf" | "lf-in-cr" | "force-crlf" | "force-lf" | "force-cr" | "strip";

export interface SshHost {
  name: string;
  [key: string]: string;
}

export interface LocalProfile {
  name: string;
  command: string;
}

export interface VsInstallation {
  path: string;
  version: string;
  instance_id?: string | null;
}

export interface SerialPort {
  name: string;
  driver: string;
  manufacturer: string;
  product: string;
  vid: string;
  pid: string;
}

export interface SerialParams {
  baud: number;
  inputMode?: SerialInputMode;
  outputNewline?: SerialOutputNewline;
  enterNewline?: SerialEnterNewline;
}

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

// ---- Utility functions ----

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
    .filter(line => line.trim() !== "")
    .join("\n");
}
