// Lightweight reactive Config Store — single source of truth for all app config.
// Replaces 20+ mutable `export let` variables from profiles.ts and the
// settingsChangedFn callback bridge from settings-events.ts.
//
// Design: pub/sub pattern, declarative schema, zero third-party dependencies.

import { invoke } from "@tauri-apps/api/core";
import { buildFontFamily, defaultFontStack } from "../util/fontconfig";
import { DEFAULT_THEME_NAME } from "../util/themes";
import { logError, swallow } from "./errorlog";
import type { LocalProfile, SerialPort, SshHost, VsInstallation } from "./types";

// ---- All config state in one interface ----

export interface ConfigState {
  // External data (not persisted to config file)
  sshHosts: SshHost[];
  localProfiles: LocalProfile[];
  vsInstalls: VsInstallation[];
  serialPorts: SerialPort[];
  // Persisted config
  hiddenProfiles: string[];
  hiddenSshHosts: string[];
  fontFamily: string;
  fontSize: number;
  scrollback: number;
  themeName: string;
  // Chrome skin for Settings / menus / quick panel ("cursor" | "vscode").
  // Tab bar stays fixed dark regardless; terminal schemes are independent.
  chromeSkin: string;
  // Frosted translucency for the quick panel only (window stays opaque).
  quickPanelGlass: boolean;
  renderer: string;
  terminalBell: boolean;
  pasteWarning: boolean;
  pasteTrim: boolean;
  // Ask before closing the window while any tab is open (confirm-preview).
  confirmCloseWindow: boolean;
  // Ask (in-tab Confirm: + Close) before closing a tab via ×.
  confirmCloseTab: boolean;
  serialBaud: number;
  // Default serial profile name (built-in or custom). The rest of the
  // serial defaults live in profiles (serial-profiles.json), not here.
  serialProfile: string;
  // Data/parity/stop frame for new serial sessions (8N1 / 8E1 / 8O1).
  serialFrame: string;
  defaultLocalProfile: string | null;
  autoCheckUpdates: boolean;
  // Built-in SSH client (russh) instead of spawning the system ssh binary.
  sshEmbedded: boolean;
  recentDirectories: string[];
  // User keybinding overrides: command id → combo ("ctrl+shift+p"), "" = unbound.
  // Merged over the defaults in core/keymap.ts; ids not in the registry are ignored.
  keybindings: Record<string, string>;
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
const isNumber =
  (min: number, max: number) =>
  (v: unknown): v is number =>
    typeof v === "number" && v >= min && v <= max;
const isArray = <T = unknown>(v: unknown): v is T[] => Array.isArray(v);
const isStringRecord = (v: unknown): v is Record<string, string> =>
  typeof v === "object" &&
  v !== null &&
  !Array.isArray(v) &&
  Object.values(v).every((x) => typeof x === "string");
const isOrNull =
  <T>(guard: (v: unknown) => v is T) =>
  (v: unknown): v is T | null =>
    v === null || guard(v);

const SCHEMA = {
  sshHosts: { default: [] as SshHost[], validate: isArray<SshHost> },
  localProfiles: { default: [] as LocalProfile[], validate: isArray<LocalProfile> },
  vsInstalls: { default: [] as VsInstallation[], validate: isArray<VsInstallation> },
  serialPorts: { default: [] as SerialPort[], validate: isArray<SerialPort> },
  hiddenProfiles: { default: [] as string[], validate: isArray<string> },
  hiddenSshHosts: { default: [] as string[], validate: isArray<string> },
  fontFamily: { default: buildFontFamily(defaultFontStack()), validate: isString },
  fontSize: { default: 14, validate: isNumber(10, 32) },
  scrollback: { default: 20000, validate: isNumber(100, 100000) },
  themeName: { default: DEFAULT_THEME_NAME, validate: isString },
  chromeSkin: {
    default: "cursor",
    validate: (v: unknown): v is string => v === "cursor" || v === "vscode",
  },
  quickPanelGlass: { default: false, validate: isBoolean },
  renderer: { default: "webgl", validate: isString },
  terminalBell: { default: false, validate: isBoolean },
  pasteWarning: { default: true, validate: isBoolean },
  pasteTrim: { default: true, validate: isBoolean },
  confirmCloseWindow: { default: true, validate: isBoolean },
  confirmCloseTab: { default: true, validate: isBoolean },
  serialBaud: { default: 115200, validate: isNumber(300, 921600) },
  serialProfile: { default: "Normal", validate: isString },
  serialFrame: {
    default: "8N1",
    validate: (v: unknown): v is string => v === "8N1" || v === "8E1" || v === "8O1",
  },
  defaultLocalProfile: { default: null as string | null, validate: isOrNull(isString) },
  autoCheckUpdates: { default: true, validate: isBoolean },
  sshEmbedded: { default: true, validate: isBoolean },
  recentDirectories: { default: [] as string[], validate: isArray<string> },
  keybindings: { default: {} as Record<string, string>, validate: isStringRecord },
  loaded: { default: false, validate: isBoolean },
} satisfies Record<string, SchemaEntry<unknown>>;

type SchemaKey = keyof typeof SCHEMA;

// Keys that are NOT persisted to the config file (runtime-only data)
const RUNTIME_KEYS = new Set<SchemaKey>([
  "loaded",
  "serialPorts",
  "vsInstalls",
  "sshHosts",
  "localProfiles",
]);

function defaultState(): ConfigState {
  const state = {} as ConfigState;
  for (const [key, entry] of Object.entries(SCHEMA) as [SchemaKey, SchemaEntry<unknown>][]) {
    setStateKey(state, key, entry.default);
  }
  return state;
}

/** Write one schema-validated key into the typed state. Object.assign keeps
 *  the dynamic-key write type-safe without casting the state to `any` — the
 *  schema has already validated the value at each call site. */
function setStateKey(state: ConfigState, key: string, value: unknown): void {
  Object.assign(state, { [key]: value });
}

// ---- Pub/sub store ----

type Listener = (changedKeys: string[]) => void;

export class ConfigStore {
  private _state: ConfigState = defaultState();
  private _listeners = new Set<Listener>();
  private _saveTimer: ReturnType<typeof setTimeout> | null = null;
  private _pendingMerge: Record<string, unknown> | null = null;

  /** Read a single config value. */
  get<K extends keyof ConfigState>(key: K): ConfigState[K] {
    return this._state[key];
  }

  /** Batch-write config values. Memory updates immediately; disk write is debounced 300ms. */
  set(partial: Partial<ConfigState>): void {
    const changed: string[] = [];
    const persisted: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(partial)) {
      const key = k as SchemaKey;
      if (key in SCHEMA && SCHEMA[key].validate(v)) {
        setStateKey(this._state, key, v);
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
      // A pending debounced write holds STALE in-memory values; if it fires
      // after we re-read the disk (e.g. Revert), it writes the reverted
      // values straight back. Disk is truth now — cancel it.
      if (this._saveTimer) {
        clearTimeout(this._saveTimer);
        this._saveTimer = null;
      }
      this._pendingMerge = null;

      // keybindings live in their OWN file (keybindings.json — VS Code
      // parity); everything else in config.json. Raw I/O only in Rust;
      // parsing/merging/migration happen here.
      const [raw, kbRaw] = await Promise.all([
        invoke<string>("read_config_file", { name: "config" }),
        invoke<string>("read_config_file", { name: "keybindings" }),
      ]);
      const cfg = JSON.parse(raw);
      const isEmpty = Object.keys(cfg).length === 0;

      let kb: unknown = {};
      try {
        kb = JSON.parse(kbRaw);
      } catch {
        swallow(); // broken keybindings.json — defaults, never take the config down.
      }
      const kbValid: Record<string, string> = SCHEMA.keybindings.validate(kb) ? kb : {};

      // Migration: keybindings used to live inside config.json. Adopt them
      // into keybindings.json and strip the key from config.json — one
      // rewrite, every other key untouched.
      let migratedKb: Record<string, string> | null = null;
      if (SCHEMA.keybindings.validate(cfg.keybindings)) {
        if (Object.keys(kbValid).length === 0 && Object.keys(cfg.keybindings).length > 0) {
          migratedKb = cfg.keybindings;
        }
        delete cfg.keybindings;
      }
      const configWithoutKb = { ...cfg };
      cfg.keybindings = migratedKb ?? kbValid;

      // Keys ABSENT from the file (old config from before a key existed,
      // or a deleted config) must fall back to defaults, not to whatever
      // stale value memory currently holds. Runtime keys are untouched.
      const base: Record<string, unknown> = {};
      for (const [key, entry] of Object.entries(SCHEMA) as [SchemaKey, SchemaEntry<unknown>][]) {
        if (!RUNTIME_KEYS.has(key)) base[key] = entry.default;
      }
      this._applyConfig({ ...base, ...cfg });
      if (isEmpty) {
        const defaults = this._persistableSnapshot();
        this._applyConfig(defaults);
        await this._writeDisk(defaults);
      }
      if (migratedKb) {
        await invoke("write_config_file", {
          name: "keybindings",
          content: JSON.stringify(migratedKb),
        });
        await invoke("write_config_file", {
          name: "config",
          content: JSON.stringify(configWithoutKb),
        });
      }
      this._state.loaded = true;
      // Notify ALL schema keys, not just the ones the file mentioned:
      // subscribers (keymap lookup, terminal options) must re-apply
      // defaults too, or Reset All / Revert silently keep old values
      // until restart.
      this._notify(Object.keys(SCHEMA));
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
        setStateKey(this._state, key, v);
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
      const { keybindings, ...rest } = data;
      const jobs: Promise<unknown>[] = [];
      if (keybindings !== undefined) {
        jobs.push(
          invoke("write_config_file", {
            name: "keybindings",
            content: JSON.stringify(keybindings),
          }),
        );
      }
      if (Object.keys(rest).length > 0) {
        // Merge with existing on-disk config before writing
        let existing: Record<string, unknown> = {};
        try {
          const raw = await invoke<string>("read_config_file", { name: "config" });
          existing = JSON.parse(raw);
        } catch {
          swallow(); // first write or read error — start fresh
        }
        // keybindings never lands in config.json, even if a stale copy
        // survived the migration (hand-edited file).
        delete existing.keybindings;
        jobs.push(
          invoke("write_config_file", {
            name: "config",
            content: JSON.stringify({ ...existing, ...rest }),
          }),
        );
      }
      await Promise.all(jobs);
    } catch (e) {
      logError("config.write", e);
    }
  }

  private _persistableSnapshot(): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(this._state)) {
      // keybindings persist to their own file, never config.json.
      if (!RUNTIME_KEYS.has(k as SchemaKey) && k !== "keybindings") result[k] = v;
    }
    return result;
  }

  private _notify(changed: string[]): void {
    for (const fn of this._listeners) fn(changed);
  }
}

export const configStore = new ConfigStore();
