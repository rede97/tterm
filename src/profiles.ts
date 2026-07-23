import { invoke } from "@tauri-apps/api/core";
import { buildFontFamily, defaultFontStack } from "./fontconfig";
import { setWtThemes, parseWtSchemes, DEFAULT_THEME_NAME } from "./themes";

// SshHost is a simple KV map: { name, hostname, user, port, forwardagent, ... }
// All values are strings. Frontend owns all parsing + generation.
// Keys preserve original SSH config casing (e.g. "ForwardAgent" not "forwardagent").
export type SshHost = { name: string } & Record<string, string>;

export function hostProp(h: SshHost, key: string): string | undefined {
  if (h[key] !== undefined) return h[key];
  const lower = key.toLowerCase();
  for (const k of Object.keys(h)) {
    if (k.toLowerCase() === lower) return h[k];
  }
  return undefined;
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

export type SerialInputMode = "normal" | "echo" | "line";
export type SerialOutputNewline = "keep" | "cr-in-lf" | "lf-in-cr" | "force-crlf" | "force-lf" | "force-cr" | "strip";

export const SERIAL_OUTPUT_NEWLINES: [SerialOutputNewline, string][] = [
  ["keep", "Keep (raw)"],
  ["cr-in-lf", "Implicit CR in every LF"],
  ["lf-in-cr", "Implicit LF in every CR"],
  ["force-crlf", "Force CRLF"],
  ["force-lf", "Force LF"],
  ["force-cr", "Force CR"],
  ["strip", "Strip"],
];

export interface SerialParams {
  baud: number;
  inputMode?: SerialInputMode;
  outputNewline?: SerialOutputNewline;
}

// Per-port remembered parameters. USB devices are keyed by VID:PID (stable
// across COM number changes), others by port name.
export let serialPortParams: Record<string, SerialParams> = {};

export function serialKeyFor(port: { name: string; vid: string; pid: string }): string {
  return port.vid && port.pid ? `usb:${port.vid}:${port.pid}` : `com:${port.name}`;
}

// Effective params for a port: remembered values win, global defaults otherwise.
export function serialParamsFor(port: { name: string; vid: string; pid: string }): Required<SerialParams> {
  const mem = serialPortParams[serialKeyFor(port)];
  return {
    baud: mem?.baud ?? configSerialBaud,
    inputMode: mem?.inputMode ?? configSerialInputMode,
    outputNewline: mem?.outputNewline ?? configSerialOutputNewline,
  };
}

export async function rememberSerialParams(key: string, params: Partial<SerialParams>) {
  serialPortParams = { ...serialPortParams, [key]: { ...serialPortParams[key], ...params } };
  await saveConfig({ serialPortParams });
}

export async function forgetSerialParams(key: string) {
  const next = { ...serialPortParams };
  delete next[key];
  serialPortParams = next;
  await saveConfig({ serialPortParams });
}

// Baud for opening a port: remembered value wins, global default otherwise.
export function serialBaudFor(portName: string): number {
  return serialPortParams[`com:${portName}`]?.baud ?? configSerialBaud;
}

export async function rememberSerialBaud(portName: string, baud: number) {
  await rememberSerialParams(`com:${portName}`, { baud });
}

export let sshHosts: SshHost[] = [];
export let localProfiles: LocalProfile[] = [];
export let vsInstalls: VsInstallation[] = [];
export let defaultLocalProfile: string | null = null;
export let configFontFamily = buildFontFamily(defaultFontStack());
export let configFontSize = 14;
export let hiddenProfiles: string[] = [];
export let configPasteWarning = true;
export let configPasteTrim = true;
export let configTerminalBell = false;
export let configRenderer = "webgl";
export let configScrollback = 20000;
export let configTabWidthMode = "equal";
export let configThemeName: string = DEFAULT_THEME_NAME;
export let configSerialBaud = 115200;
export let configSerialInputMode: SerialInputMode = "normal";
export let configSerialOutputNewline: SerialOutputNewline = "keep";

// Common baud rates offered in menus and settings.
export const SERIAL_BAUD_RATES = [9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600];
export let hiddenSshHosts: string[] = [];
export let serialPorts: SerialPort[] = [];
export let configLoaded = false;

// -- SSH hosts (frontend-owned parsing) --

export function parseSshConfig(raw: string): SshHost[] {
  const hosts: SshHost[] = [];
  let current: SshHost | null = null;
  const preProps: Record<string, string> = {};
  let wildcardProps: Record<string, string> = {};

  const flush = () => {
    if (!current) return;
    const names = (current as any).__names || [current.name];
    for (const n of names) {
      const h: SshHost = { name: n, ...wildcardProps, ...preProps };
      for (const [k, v] of Object.entries(current)) {
        if (k !== "name" && !(k as any).startsWith("__")) h[k] = v;
      }
      if (n === "*") {
        wildcardProps = { ...h };
        delete (wildcardProps as any).name;
        delete (wildcardProps as any).__names;
      } else {
        hosts.push(h);
      }
    }
  };

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const spaceIdx = trimmed.search(/\s/);
    if (spaceIdx === -1) continue;
    const rawKey = trimmed.slice(0, spaceIdx);
    const key = rawKey.toLowerCase();
    const value = trimmed.slice(spaceIdx + 1).trim();

    if (key === "host") {
      flush();
      const names = value.split(/\s+/);
      current = { name: names[0], __names: names } as any;
    } else if (current) {
      (current as any)[rawKey] = value;
    } else {
      preProps[rawKey] = value;
    }
  }
  // flush last host
  flush();
  for (const h of hosts) { delete (h as any).__names; }
  return hosts;
}

export async function loadSshHosts() {
  try {
    const raw = await invoke<string>("ssh_read_config_raw");
    if (raw) sshHosts = parseSshConfig(raw);
  } catch (e) {
    console.error("Failed to load SSH hosts:", e);
  }
}

// -- Windows Terminal profiles --

function resolveVsProfile(name: string): string | null {
  if (vsInstalls.length === 0) return null;
  const yearMatch = name.match(/\b(20\d\d)\b/);
  const year = yearMatch ? yearMatch[1] : null;
  const vs = year
    ? vsInstalls.find(v => v.path.includes(year)) || vsInstalls[0]
    : vsInstalls[0];
  if (/developer command prompt/i.test(name)) {
    return `%comspec% /k "${vs.path}\\Common7\\Tools\\VsDevCmd.bat"`;
  }
  if (/developer powershell/i.test(name)) {
    const instanceId = vs.instance_id;
    if (!instanceId) return null;
    return `powershell.exe -NoExit -Command "& { Import-Module '${vs.path}\\Common7\\Tools\\Microsoft.VisualStudio.DevShell.dll'; Enter-VsDevShell -VsInstanceId ${instanceId} }"`;
  }
  return null;
}

function addProfile(item: any) {
  if (item.hidden) return;
  const src = (item.source || "") as string;
  const name: string | null | undefined = item.name;
  if (!name) return;
  let command: string | null | undefined = item.commandline;
  if (!command) {
    if (/terminal\.visualstudio/i.test(src)) {
      command = resolveVsProfile(name);
    } else if (/terminal\.wsl/i.test(src)) {
      command = `wsl.exe -d "${name}"`;
    } else if (/terminal\.azure/i.test(src)) {
      command = `wt.exe -p "${name}"`;
    }
  }
  if (!command && !item.source) {
    command = name;
  }
  if (command && !localProfiles.some(p => p.name === name)) {
    localProfiles.push({ name, command });
  }
}

function parseProfilesFromJson(root: any) {
  const list: any[] = root?.profiles?.list;
  if (list) {
    for (const item of list) addProfile(item);
    return;
  }
  const arr: any[] = root?.profiles;
  if (arr) {
    for (const item of arr) addProfile(item);
  }
}

function parseWtProfiles(raw: string) {
  try {
    localProfiles = [];
    parseProfilesFromJson(JSON.parse(raw));
  } catch (e) {
    console.error("Failed to parse WT profiles:", e);
  }
}

function parseWtFragments(fragments: string[]) {
  for (const frag of fragments) {
    try {
      parseProfilesFromJson(JSON.parse(frag));
    } catch (_) { /* skip malformed fragments */ }
  }
}

export async function loadLocalProfiles() {
  try {
    vsInstalls = await invoke<VsInstallation[]>("find_vs_instances");
  } catch (e) {
    console.error("Failed to find VS instances:", e);
  }
  try {
    const raw = await invoke<string | null>("read_wt_settings");
    if (raw) {
      parseWtProfiles(raw);
      setWtThemes(parseWtSchemes(raw));
    }
    const fragments = await invoke<string[]>("read_wt_fragments");
    if (fragments && fragments.length > 0) parseWtFragments(fragments);
  } catch (e) {
    console.error("Failed to load WT profiles:", e);
  }
}

// -- Serial ports (enumeration via Windows registry/SetupAPI) --

export async function loadSerialPorts() {
  try {
    serialPorts = await invoke<SerialPort[]>("serial_list_ports");
  } catch (e) {
    console.error("Failed to list serial ports:", e);
    serialPorts = [];
  }
}

// -- config persistence ---

function readConfigValues(cfg: any) {
  if (cfg.defaultLocalProfile) defaultLocalProfile = cfg.defaultLocalProfile;
  if (typeof cfg.fontFamily === "string") configFontFamily = cfg.fontFamily;
  if (typeof cfg.fontSize === "number" && cfg.fontSize >= 10 && cfg.fontSize <= 32) configFontSize = cfg.fontSize;
  if (Array.isArray(cfg.hiddenProfiles)) hiddenProfiles = cfg.hiddenProfiles;
  if (typeof cfg.pasteWarning === "boolean") configPasteWarning = cfg.pasteWarning;
  if (typeof cfg.pasteTrim === "boolean") configPasteTrim = cfg.pasteTrim;
  if (typeof cfg.terminalBell === "boolean") configTerminalBell = cfg.terminalBell;
  if (typeof cfg.renderer === "string") configRenderer = cfg.renderer;
  if (typeof cfg.scrollback === "number" && cfg.scrollback >= 100 && cfg.scrollback <= 100000) configScrollback = cfg.scrollback;
  if (typeof cfg.tabWidthMode === "string") configTabWidthMode = cfg.tabWidthMode;
  if (typeof cfg.themeName === "string") configThemeName = cfg.themeName;
  if (typeof cfg.serialBaud === "number" && cfg.serialBaud >= 300 && cfg.serialBaud <= 921600) configSerialBaud = cfg.serialBaud;
  if (cfg.serialInputMode === "normal" || cfg.serialInputMode === "echo" || cfg.serialInputMode === "line") configSerialInputMode = cfg.serialInputMode;
  if (typeof cfg.serialOutputNewline === "string" && SERIAL_OUTPUT_NEWLINES.some(([v]) => v === cfg.serialOutputNewline)) configSerialOutputNewline = cfg.serialOutputNewline;
  if (cfg.serialPortParams && typeof cfg.serialPortParams === "object") serialPortParams = cfg.serialPortParams;
  if (Array.isArray(cfg.hiddenSshHosts)) hiddenSshHosts = cfg.hiddenSshHosts;
}

export function getDefaultConfig(): Record<string, unknown> {
  return {
    fontFamily: buildFontFamily(defaultFontStack()),
    fontSize: 14,
    pasteWarning: true,
    pasteTrim: true,
    terminalBell: false,
    renderer: "webgl",
    scrollback: 20000,
    tabWidthMode: "equal",
    themeName: DEFAULT_THEME_NAME,
    serialBaud: 115200,
    serialInputMode: "normal",
    serialOutputNewline: "keep",
    serialPortParams: {},
    hiddenProfiles: [],
    hiddenSshHosts: [],
  };
}

export async function loadConfig() {
  try {
    const raw = await invoke<string>("read_config");
    const cfg = JSON.parse(raw);
    readConfigValues(cfg);
    const isEmpty = Object.keys(cfg).length === 0;
    if (isEmpty) {
      const defaults = getDefaultConfig();
      readConfigValues(defaults);
      await saveConfig(defaults);
    }
    return cfg;
  } catch {
    configLoaded = true;
    return {};
  }
}

export async function saveConfig(partial: Record<string, unknown>) {
  let existing: any = {};
  try {
    const raw = await invoke<string>("read_config");
    existing = JSON.parse(raw);
  } catch {}
  const merged = { ...existing, ...partial };
  readConfigValues(merged);
  try { await invoke("write_config", { content: JSON.stringify(merged) }); } catch {}
}

export async function setDefaultProfile(name: string) {
  await saveConfig({ defaultLocalProfile: name });
}
export function trimPasteContent(text: string): string {
  if (!configPasteTrim) return text;
  return text
    .trim()
    .split("\n")
    .filter(line => line.trim() !== "")
    .join("\n");
}

// exposed for settings page
(window as any).setDefaultProfile = setDefaultProfile;


