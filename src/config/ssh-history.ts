// Temporary Connect history — persisted in ssh-history.json under the app
// config dir (NOT ~/.ssh/config, NOT config.json). Passwords are never stored.
// Rust does raw file I/O; parsing / MRU / cap live here. Mirrors serial-profiles.

import { invoke } from "@tauri-apps/api/core";
import { logError } from "../core/errorlog";
import type { SshHost } from "../core/types";

export interface SshHistoryEntry {
  user?: string;
  hostname: string;
  /** Omitted or "22" means default SSH port. */
  port?: string;
  lastUsed: number;
}

const MAX_ENTRIES = 30;
const FILE = "ssh-history";

/** Normalize port for equality: missing / empty / "22" → "22". */
export function normPort(port: string | undefined): string {
  const p = (port ?? "").trim();
  return !p || p === "22" ? "22" : p;
}

export function historyKey(e: { user?: string; hostname: string; port?: string }): string {
  return `${e.user ?? ""}@${e.hostname}:${normPort(e.port)}`;
}

export function entryLabel(e: SshHistoryEntry): string {
  const base = e.user ? `${e.user}@${e.hostname}` : e.hostname;
  return normPort(e.port) === "22" ? base : `${base}:${e.port}`;
}

export function entryToHost(e: SshHistoryEntry): SshHost {
  const host: SshHost = { name: e.hostname, hostname: e.hostname };
  if (e.user) host.user = e.user;
  if (normPort(e.port) !== "22") host.port = normPort(e.port);
  return host;
}

export function hostToEntry(host: SshHost, lastUsed = Date.now()): SshHistoryEntry {
  const hostname = host.hostname || host.name;
  const entry: SshHistoryEntry = { hostname, lastUsed };
  if (host.user) entry.user = host.user;
  const p = normPort(host.port);
  if (p !== "22") entry.port = p;
  return entry;
}

/** Keep only valid fields; drop junk silently. */
export function sanitizeEntry(raw: unknown): SshHistoryEntry | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.hostname !== "string" || !o.hostname.trim()) return null;
  const lastUsed = typeof o.lastUsed === "number" && Number.isFinite(o.lastUsed) ? o.lastUsed : 0;
  const entry: SshHistoryEntry = { hostname: o.hostname.trim(), lastUsed };
  if (typeof o.user === "string" && o.user.trim()) entry.user = o.user.trim();
  if (typeof o.port === "string" && o.port.trim()) {
    const p = normPort(o.port);
    if (p !== "22") entry.port = p;
  }
  return entry;
}

/** Parse ssh-history.json; invalid entries skipped. Newest first. */
export function parseSshHistory(raw: string): SshHistoryEntry[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const byKey = new Map<string, SshHistoryEntry>();
    for (const item of parsed) {
      const e = sanitizeEntry(item);
      if (!e) continue;
      const k = historyKey(e);
      const prev = byKey.get(k);
      if (!prev || e.lastUsed >= prev.lastUsed) byKey.set(k, e);
    }
    return [...byKey.values()].sort((a, b) => b.lastUsed - a.lastUsed).slice(0, MAX_ENTRIES);
  } catch (err) {
    logError("sshHistory.parse", err);
    return [];
  }
}

export function serializeSshHistory(entries: SshHistoryEntry[]): string {
  return JSON.stringify(
    entries.map((e) => {
      const out: Record<string, unknown> = {
        hostname: e.hostname,
        lastUsed: e.lastUsed,
      };
      if (e.user) out.user = e.user;
      if (e.port && normPort(e.port) !== "22") out.port = normPort(e.port);
      return out;
    }),
    null,
    2,
  );
}

/** Insert/bump MRU and cap. Pure — caller persists. */
export function rememberInList(
  current: SshHistoryEntry[],
  host: SshHost,
  now = Date.now(),
): SshHistoryEntry[] {
  const next = hostToEntry(host, now);
  const k = historyKey(next);
  const rest = current.filter((e) => historyKey(e) !== k);
  return [next, ...rest].slice(0, MAX_ENTRIES);
}

// -- Registry (in-memory, like serial-profiles) --

let cached: SshHistoryEntry[] = [];

export function listSshHistory(): SshHistoryEntry[] {
  return [...cached];
}

export function setSshHistory(entries: SshHistoryEntry[]): void {
  cached = entries;
}

export async function loadSshHistory(): Promise<SshHistoryEntry[]> {
  const raw = await invoke<string>("read_config_file", { name: FILE });
  // Empty / missing file returns "{}" from Rust — treat as no history.
  const entries = raw.trim() === "{}" ? [] : parseSshHistory(raw);
  setSshHistory(entries);
  return entries;
}

/** Persist + bump MRU. Fire-and-forget safe (returns the new list). */
export async function rememberSshHistory(host: SshHost): Promise<SshHistoryEntry[]> {
  const current = parseSshHistory(
    await invoke<string>("read_config_file", { name: FILE }).then((raw) =>
      raw.trim() === "{}" ? "[]" : raw,
    ),
  );
  const next = rememberInList(current, host);
  await invoke("write_config_file", {
    name: FILE,
    content: serializeSshHistory(next),
  });
  setSshHistory(next);
  return next;
}
