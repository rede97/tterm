// Serial profiles — named session modes (input mode, Enter terminator,
// output newline conversion, flow control). Persisted in their OWN file
// (serial-profiles.json in the app config dir), NOT config.json. Rust does
// raw file I/O; parsing/validation lives here. Mirrors custom-themes.ts.

import { invoke } from "@tauri-apps/api/core";
import { logError } from "../core/errorlog";
import type {
  SerialEnterNewline,
  SerialFlowControl,
  SerialInputMode,
  SerialOutputNewline,
  SerialProfile,
} from "../core/types";

export interface SerialProfileDef extends SerialProfile {
  source: "builtin" | "custom";
}

export const BUILTIN_SERIAL_PROFILES: SerialProfileDef[] = [
  {
    // Direct interactive mode: shells and embedded TUIs (uboot, UEFI).
    name: "Normal",
    inputMode: "normal",
    enterNewline: "cr",
    outputNewline: "keep",
    flowControl: "none",
    source: "builtin",
  },
  {
    // Recording device output: bare LF becomes CRLF so prints don't staircase.
    name: "Log",
    inputMode: "normal",
    enterNewline: "cr",
    outputNewline: "cr-in-lf",
    flowControl: "none",
    source: "builtin",
  },
  {
    // Modem-style: line-by-line editing with local echo, Enter sends CRLF.
    name: "AT",
    inputMode: "line",
    enterNewline: "crlf",
    outputNewline: "keep",
    flowControl: "none",
    source: "builtin",
  },
];

export const DEFAULT_SERIAL_PROFILE = "Normal";

const INPUT_MODES: readonly SerialInputMode[] = ["normal", "echo", "line"];
const ENTER_NEWLINES: readonly SerialEnterNewline[] = ["cr", "lf", "crlf"];
const OUTPUT_NEWLINES: readonly SerialOutputNewline[] = [
  "keep",
  "cr-in-lf",
  "lf-in-cr",
  "force-crlf",
  "force-lf",
  "force-cr",
  "strip",
];
const FLOW_CONTROLS: readonly SerialFlowControl[] = ["none", "software", "hardware"];

function pick<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

/** Keep only valid fields; every field falls back to Normal-mode values. */
export function sanitizeSerialProfile(raw: unknown): SerialProfile | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  return {
    name: "", // filled by the caller
    inputMode: pick(o.inputMode, INPUT_MODES, "normal"),
    enterNewline: pick(o.enterNewline, ENTER_NEWLINES, "cr"),
    outputNewline: pick(o.outputNewline, OUTPUT_NEWLINES, "keep"),
    flowControl: pick(o.flowControl, FLOW_CONTROLS, "none"),
  };
}

/** Parse serial-profiles.json content; invalid entries are skipped. */
export function parseSerialProfiles(raw: string): SerialProfileDef[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: SerialProfileDef[] = [];
    for (const entry of parsed) {
      if (typeof entry !== "object" || entry === null) continue;
      const name = (entry as Record<string, unknown>).name;
      const body = sanitizeSerialProfile(entry);
      if (typeof name === "string" && name.trim() && body) {
        out.push({ ...body, name: name.trim(), source: "custom" });
      }
    }
    return out;
  } catch (e) {
    logError("serialProfiles.parse", e);
    return [];
  }
}

export function serializeSerialProfiles(themes: SerialProfileDef[]): string {
  return JSON.stringify(
    themes.map((t) => ({
      name: t.name,
      inputMode: t.inputMode,
      enterNewline: t.enterNewline,
      outputNewline: t.outputNewline,
      flowControl: t.flowControl,
    })),
    null,
    2,
  );
}

// -- Registry (module state, like util/themes custom themes) --

let customProfiles: SerialProfileDef[] = [];

export function setCustomSerialProfiles(profiles: SerialProfileDef[]): void {
  customProfiles = profiles;
}

export function allSerialProfiles(): SerialProfileDef[] {
  return [...BUILTIN_SERIAL_PROFILES, ...customProfiles];
}

/** Resolve by name; unknown/missing names fall back to Normal. */
export function findSerialProfile(name: string | null | undefined): SerialProfileDef {
  if (name) {
    const hit = allSerialProfiles().find((p) => p.name === name);
    if (hit) return hit;
  }
  return BUILTIN_SERIAL_PROFILES[0];
}

/** Load serial-profiles.json into the registry. Call once at startup. */
export async function loadSerialProfiles(): Promise<SerialProfileDef[]> {
  const raw = await invoke<string>("read_config_file", { name: "serial-profiles" });
  const profiles = parseSerialProfiles(raw);
  setCustomSerialProfiles(profiles);
  return profiles;
}

export function dedupeSerialProfileName(base: string): string {
  const taken = new Set(allSerialProfiles().map((p) => p.name));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base} ${i}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** Insert or replace (match by originalName when renaming) and persist. */
export async function saveSerialProfile(
  profile: SerialProfile,
  originalName?: string,
): Promise<SerialProfileDef[]> {
  const current = parseSerialProfiles(
    await invoke<string>("read_config_file", { name: "serial-profiles" }),
  );
  const def: SerialProfileDef = { ...profile, source: "custom" };
  const idx = current.findIndex((t) => t.name === (originalName ?? profile.name));
  if (idx >= 0) current.splice(idx, 1, def);
  else current.push(def);
  await invoke("write_config_file", {
    name: "serial-profiles",
    content: serializeSerialProfiles(current),
  });
  setCustomSerialProfiles(current);
  return current;
}

export async function deleteSerialProfile(name: string): Promise<SerialProfileDef[]> {
  const current = parseSerialProfiles(
    await invoke<string>("read_config_file", { name: "serial-profiles" }),
  ).filter((t) => t.name !== name);
  await invoke("write_config_file", {
    name: "serial-profiles",
    content: serializeSerialProfiles(current),
  });
  setCustomSerialProfiles(current);
  return current;
}
