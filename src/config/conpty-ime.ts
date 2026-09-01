// ConPTY IME caps — persisted in conpty-ime.json (NOT config.json).
// Re-probed when TTerm's app version changes so a Win10 user who updates
// picks up the adapter automatically. Parsing lives here; Rust only does
// the OS/ConPTY probe and raw file I/O.

import { invoke } from "@tauri-apps/api/core";
import { logError } from "../core/errorlog";

export const CONPTY_IME_FILE = "conpty-ime";

export interface ConptyImeCaps {
  appVersion: string;
  win10: boolean;
  winBuild: number;
  cursorHideForwarded: boolean;
  probedAt: number;
}

export interface ImeCapsProbe {
  win10: boolean;
  winBuild: number;
  cursorHideForwarded: boolean;
}

let cached: ConptyImeCaps | null = null;

export function getConptyImeCaps(): ConptyImeCaps | null {
  return cached;
}

/** Test/e2e hatch — does not persist. */
export function setConptyImeCaps(caps: ConptyImeCaps | null): void {
  cached = caps;
}

export function parseConptyImeCaps(raw: string): ConptyImeCaps | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    const o = parsed as Record<string, unknown>;
    if (typeof o.appVersion !== "string") return null;
    if (typeof o.win10 !== "boolean") return null;
    if (typeof o.winBuild !== "number" || !Number.isFinite(o.winBuild)) return null;
    if (typeof o.cursorHideForwarded !== "boolean") return null;
    const probedAt = typeof o.probedAt === "number" && Number.isFinite(o.probedAt) ? o.probedAt : 0;
    return {
      appVersion: o.appVersion,
      win10: o.win10,
      winBuild: o.winBuild,
      cursorHideForwarded: o.cursorHideForwarded,
      probedAt,
    };
  } catch (err) {
    logError("conptyIme.parse", err);
    return null;
  }
}

export function serializeConptyImeCaps(caps: ConptyImeCaps): string {
  return JSON.stringify(caps, null, 2);
}

export function capsFreshForVersion(caps: ConptyImeCaps | null, appVersion: string): boolean {
  return !!caps && caps.appVersion === appVersion && appVersion.length > 0;
}

/** Load the on-disk cache. Missing/empty/`{}` → null. */
export async function loadConptyImeCaps(): Promise<ConptyImeCaps | null> {
  const raw = await invoke<string>("read_config_file", { name: CONPTY_IME_FILE });
  const caps = raw.trim() === "{}" ? null : parseConptyImeCaps(raw);
  cached = caps;
  return caps;
}

async function persistCaps(caps: ConptyImeCaps): Promise<void> {
  await invoke("write_config_file", {
    name: CONPTY_IME_FILE,
    content: serializeConptyImeCaps(caps),
  });
  cached = caps;
}

/**
 * If the file is missing or was written by an older TTerm, run the backend
 * probe (Win11 returns immediately; Win10 types a VT fixture through ConPTY)
 * and rewrite conpty-ime.json. Call after configStore.load(); never blocks
 * the first tab.
 */
export async function refreshConptyImeCaps(appVersion: string): Promise<ConptyImeCaps | null> {
  const existing = cached ?? (await loadConptyImeCaps());
  if (capsFreshForVersion(existing, appVersion)) return existing;
  const probe = await invoke<ImeCapsProbe>("pty_probe_ime_caps");
  const caps: ConptyImeCaps = {
    appVersion,
    win10: probe.win10,
    winBuild: probe.winBuild,
    cursorHideForwarded: probe.cursorHideForwarded,
    probedAt: Date.now(),
  };
  await persistCaps(caps);
  return caps;
}
