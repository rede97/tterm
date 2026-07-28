// Lightweight reactive Config Store — single source of truth for all app config.
// Replaces 20+ mutable `export let` variables from profiles.ts and the
// settingsChangedFn callback bridge from settings-events.ts.
//
// Design: pub/sub pattern, declarative schema, zero third-party dependencies.

import { invoke } from "@tauri-apps/api/core";
import { buildFontFamily, defaultFontStack } from "../util/fontconfig";
import { DEFAULT_THEME_NAME } from "../util/themes";
import { logError } from "./errorlog";
import type {
  SshHost, LocalProfile, VsInstallation, SerialPort,
  SerialParams, SerialInputMode, SerialOutputNewline, SerialEnterNewline,
} from "./types";
import { SERIAL_OUTPUT_NEWLINES } from "./common";

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

// ---- Declarative schema: single source of truth for defaults + validation ----

interface SchemaEntry<T> {
  default: T;
  validate: (v: unknown) => v is T;
}

const isString = (v: unknown): v is string => typeof v === "string";
const isBoolean = (v: unknown): v is boolean => typeof v === "boolean";
const isNumber = (min: number, max: number) => (v: unknown): v is number => typeof v === "number" && v >= min && v <= max;
const isArray = <T = unknown>(v: unknown): v is T[] => Array.isArray(v);
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isOneOf = <T extends string>(values: readonly T[]) => (v: unknown): v is T => typeof v === "string" && (values as readonly string[]).includes(v);
const isOrNull = <T>(guard: (v: unknown) => v is T) => (v: unknown): v is T | null => v === null || guard(v);

const SERIAL_INPUT_MODES = ["normal", "echo", "line"] as const;
const SERIAL_ENTER_MODES = ["cr", "lf", "crlf"] as const;
const OUTPUT_NEWLINE_VALUES = SERIAL_OUTPUT_NEWLINES.map(([v]) => v) as readonly SerialOutputNewline[];

const SCHEMA = {
  sshHosts:           { default: [] as SshHost[],          validate: isArray<SshHost> },
  localProfiles:      { default: [] as LocalProfile[],     validate: isArray<LocalProfile> },
  vsInstalls:         { default: [] as VsInstallation[],   validate: isArray<VsInstallation> },
  serialPorts:        { default: [] as SerialPort[],       validate: isArray<SerialPort> },
  serialPortParams:   { default: {} as Record<string, SerialParams>, validate: isObject },
  hiddenProfiles:     { default: [] as string[],           validate: isArray<string> },
  hiddenSshHosts:     { default: [] as string[],           validate: isArray<string> },
  fontFamily:         { default: buildFontFamily(defaultFontStack()), validate: isString },
  fontSize:           { default: 14,                       validate: isNumber(10, 32) },
  scrollback:         { default: 20000,                    validate: isNumber(100, 100000) },
  themeName:          { default: DEFAULT_THEME_NAME,       validate: isString },
  renderer:           { default: "webgl",                  validate: isString },
  terminalBell:       { default: false,                    validate: isBoolean },
  pasteWarning:       { default: true,                     validate: isBoolean },
  pasteTrim:          { default: true,                     validate: isBoolean },
  serialBaud:         { default: 115200,                   validate: isNumber(300, 921600) },
  serialInputMode:    { default: "normal" as SerialInputMode, validate: isOneOf(SERIAL_INPUT_MODES) },
  serialOutputNewline:{ default: "keep" as SerialOutputNewline, validate: isOneOf(OUTPUT_NEWLINE_VALUES) },
  serialEnterNewline: { default: "cr" as SerialEnterNewline,  validate: isOneOf(SERIAL_ENTER_MODES) },
  defaultLocalProfile: { default: null as string | null,    validate: isOrNull(isString) },
  loaded:             { default: false,                    validate: isBoolean },
} satisfies Record<string, SchemaEntry<unknown>>;

type SchemaKey = keyof typeof SCHEMA;

// Keys that are NOT persisted to the config file (runtime-only data)
const RUNTIME_KEYS = new Set<SchemaKey>(["loaded", "serialPorts", "vsInstalls", "sshHosts", "localProfiles"]);

function defaultState(): ConfigState {
  const state = {} as ConfigState;
  for (const [key, entry] of Object.entries(SCHEMA) as [SchemaKey, SchemaEntry<unknown>][]) {
    (state as any)[key] = entry.default;
  }
  return state;
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

  /** Shallow copy snapshot of the entire state. Mutations do not affect internal state. */
  snapshot(): ConfigState {
    return { ...this._state };
  }

  /** Batch-write config values. Memory updates immediately; disk write is debounced 300ms. */
  set(partial: Partial<ConfigState>): void {
    const changed: string[] = [];
    const persisted: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(partial)) {
      const key = k as SchemaKey;
      if (key in SCHEMA && SCHEMA[key].validate(v)) {
        (this._state as any)[key] = v;
        changed.push(k);
        if (!RUNTIME_KEYS.has(key)) persisted[k] = v;
      }
    }
    if (Object.keys(persisted).length > 0) {
      this._scheduleSave(persisted);
    }
    if (changed.length > 0) {
      this._notify(changed);
    }
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

  /** Validate and apply a config object to internal state using SCHEMA. */
  private _applyConfig(cfg: Record<string, unknown>): void {
    for (const [k, v] of Object.entries(cfg)) {
      const key = k as SchemaKey;
      if (key in SCHEMA && SCHEMA[key].validate(v)) {
        (this._state as any)[key] = v;
      }
    }
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
      if (!RUNTIME_KEYS.has(k as SchemaKey)) result[k] = v;
    }
    return result;
  }

  private _notify(changed: string[]): void {
    for (const fn of this._listeners) fn(changed);
  }
}

export const configStore = new ConfigStore();
