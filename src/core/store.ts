// Lightweight reactive Config Store — single source of truth for all app config.
// Replaces 20+ mutable `export let` variables from profiles.ts and the
// settingsChangedFn callback bridge from settings-events.ts.
//
// Design: pub/sub pattern, ~130 lines, zero third-party dependencies.

import { invoke } from "@tauri-apps/api/core";
import { buildFontFamily, defaultFontStack } from "../util/fontconfig";
import { DEFAULT_THEME_NAME } from "../util/themes";
import { logError } from "./errorlog";
import type {
  SshHost, LocalProfile, VsInstallation, SerialPort,
  SerialParams, SerialInputMode, SerialOutputNewline, SerialEnterNewline,
} from "./types";
import { SERIAL_OUTPUT_NEWLINES } from "./types";

// ---- All config state in one interface ----

export interface ConfigState {
  // External data (not persisted to config file)
  sshHosts: SshHost[];
  localProfiles: LocalProfile[];
  vsInstalls: VsInstallation[];
  serialPorts: SerialPort[];
  // Persisted config
  serialPortParams: Record<string, SerialParams>;
  hiddenProfiles: string[];
  hiddenSshHosts: string[];
  fontFamily: string;
  fontSize: number;
  scrollback: number;
  tabWidthMode: string;
  themeName: string;
  renderer: string;
  terminalBell: boolean;
  pasteWarning: boolean;
  pasteTrim: boolean;
  serialBaud: number;
  serialInputMode: SerialInputMode;
  serialOutputNewline: SerialOutputNewline;
  serialEnterNewline: SerialEnterNewline;
  defaultLocalProfile: string | null;
  // Runtime flag
  loaded: boolean;
}

// Keys that are NOT persisted to the config file (runtime-only data)
const RUNTIME_KEYS = new Set(["loaded", "serialPorts", "vsInstalls", "sshHosts", "localProfiles"]);

function defaultState(): ConfigState {
  return {
    sshHosts: [],
    localProfiles: [],
    vsInstalls: [],
    serialPorts: [],
    serialPortParams: {},
    hiddenProfiles: [],
    hiddenSshHosts: [],
    fontFamily: buildFontFamily(defaultFontStack()),
    fontSize: 14,
    scrollback: 20000,
    tabWidthMode: "equal",
    themeName: DEFAULT_THEME_NAME,
    renderer: "webgl",
    terminalBell: false,
    pasteWarning: true,
    pasteTrim: true,
    serialBaud: 115200,
    serialInputMode: "normal",
    serialOutputNewline: "keep",
    serialEnterNewline: "cr",
    defaultLocalProfile: null,
    loaded: false,
  };
}

// ---- Pub/sub store ----

type Listener = (changedKeys: string[]) => void;

class ConfigStore {
  private _state: ConfigState = defaultState();
  private _listeners = new Set<Listener>();
  private _saveTimer: ReturnType<typeof setTimeout> | null = null;
  private _pendingMerge: Record<string, unknown> | null = null;

  /** Read a single config value. */
  get<K extends keyof ConfigState>(key: K): ConfigState[K] {
    return this._state[key];
  }

  /** Read-only snapshot of the entire state (live reference). */
  snapshot(): Readonly<ConfigState> {
    return this._state;
  }

  /** Batch-write config values. Memory updates immediately; disk write is debounced 300ms. */
  set(partial: Partial<ConfigState>): void {
    const changed: string[] = [];
    for (const [k, v] of Object.entries(partial)) {
      (this._state as any)[k] = v;
      changed.push(k);
    }
    // Only schedule disk save for persisted keys
    const persisted: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(partial)) {
      if (!RUNTIME_KEYS.has(k)) persisted[k] = v;
    }
    if (Object.keys(persisted).length > 0) {
      this._scheduleSave(persisted);
    }
    this._notify(changed);
  }

  /** Subscribe to config changes. Returns an unsubscribe function. */
  subscribe(fn: Listener): () => void {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  /** Load config from disk via Tauri IPC. */
  async load(): Promise<void> {
    try {
      const raw = await invoke<string>("read_config");
      const cfg = JSON.parse(raw);
      const isEmpty = Object.keys(cfg).length === 0;
      this._applyConfig(cfg);
      if (isEmpty) {
        const defaults = this._persistableSnapshot();
        this._applyConfig(defaults);
        await this._writeDisk(defaults);
      }
      this._state.loaded = true;
      this._notify(Object.keys(cfg));
    } catch (e) {
      logError("config.load", e);
      this._state.loaded = true;
    }
  }

  /** Flush any pending debounced write to disk immediately (call before app exit). */
  flush(): void {
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
    }
    if (this._pendingMerge) {
      this._writeDisk(this._pendingMerge);
      this._pendingMerge = null;
    }
  }

  // ---- Internal helpers ----

  /** Validate and apply a config object to internal state. */
  private _applyConfig(cfg: any): void {
    const s = this._state;
    if (cfg.defaultLocalProfile !== undefined) s.defaultLocalProfile = cfg.defaultLocalProfile;
    if (typeof cfg.fontFamily === "string") s.fontFamily = cfg.fontFamily;
    if (typeof cfg.fontSize === "number" && cfg.fontSize >= 10 && cfg.fontSize <= 32) s.fontSize = cfg.fontSize;
    if (Array.isArray(cfg.hiddenProfiles)) s.hiddenProfiles = cfg.hiddenProfiles;
    if (typeof cfg.pasteWarning === "boolean") s.pasteWarning = cfg.pasteWarning;
    if (typeof cfg.pasteTrim === "boolean") s.pasteTrim = cfg.pasteTrim;
    if (typeof cfg.terminalBell === "boolean") s.terminalBell = cfg.terminalBell;
    if (typeof cfg.renderer === "string") s.renderer = cfg.renderer;
    if (typeof cfg.scrollback === "number" && cfg.scrollback >= 100 && cfg.scrollback <= 100000) s.scrollback = cfg.scrollback;
    if (typeof cfg.tabWidthMode === "string") s.tabWidthMode = cfg.tabWidthMode;
    if (typeof cfg.themeName === "string") s.themeName = cfg.themeName;
    if (typeof cfg.serialBaud === "number" && cfg.serialBaud >= 300 && cfg.serialBaud <= 921600) s.serialBaud = cfg.serialBaud;
    if (cfg.serialInputMode === "normal" || cfg.serialInputMode === "echo" || cfg.serialInputMode === "line") s.serialInputMode = cfg.serialInputMode;
    if (typeof cfg.serialOutputNewline === "string" && SERIAL_OUTPUT_NEWLINES.some(([v]) => v === cfg.serialOutputNewline)) s.serialOutputNewline = cfg.serialOutputNewline;
    if (cfg.serialEnterNewline === "cr" || cfg.serialEnterNewline === "lf" || cfg.serialEnterNewline === "crlf") s.serialEnterNewline = cfg.serialEnterNewline;
    if (cfg.serialPortParams && typeof cfg.serialPortParams === "object") s.serialPortParams = cfg.serialPortParams;
    if (Array.isArray(cfg.hiddenSshHosts)) s.hiddenSshHosts = cfg.hiddenSshHosts;
  }

  private _scheduleSave(persisted: Record<string, unknown>): void {
    this._pendingMerge = { ...this._pendingMerge, ...persisted };
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      if (this._pendingMerge) {
        this._writeDisk(this._pendingMerge);
        this._pendingMerge = null;
      }
    }, 300);
  }

  private async _writeDisk(data: Record<string, unknown>): Promise<void> {
    try {
      // Merge with existing on-disk config before writing
      let existing: any = {};
      try {
        const raw = await invoke<string>("read_config");
        existing = JSON.parse(raw);
      } catch { /* first write or read error — start fresh */ }
      const merged = { ...existing, ...data };
      await invoke("write_config", { content: JSON.stringify(merged) });
    } catch (e) {
      logError("config.write", e);
    }
  }

  private _persistableSnapshot(): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(this._state)) {
      if (!RUNTIME_KEYS.has(k)) result[k] = v;
    }
    return result;
  }

  private _notify(changed: string[]): void {
    for (const fn of this._listeners) fn(changed);
  }
}

export const configStore = new ConfigStore();
