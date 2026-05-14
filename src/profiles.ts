import { invoke } from "@tauri-apps/api/core";

export interface SshHost {
  name: string;
  hostname: string;
  port: number;
  user: string;
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

export let sshHosts: SshHost[] = [];
export let localProfiles: LocalProfile[] = [];
export let vsInstalls: VsInstallation[] = [];
export let defaultLocalProfile: string | null = null;
export let configFontFamily = "'JetBrains Mono', Consolas, monospace";
export let configFontSize = 14;
export let hiddenProfiles: string[] = [];
export let configLoaded = false;

// ── SSH hosts ───────────────────────────────────────────────────────

export async function loadSshHosts() {
  try {
    sshHosts = await invoke<SshHost[]>("ssh_list_hosts");
  } catch (e) {
    console.error("Failed to load SSH hosts:", e);
  }
}

// ── Windows Terminal profiles ──────────────────────────────────────

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
  if (/azure/i.test(src)) return;
  const name: string | null | undefined = item.name;
  if (!name) return;
  let command: string | null | undefined = item.commandline;
  if (!command) {
    if (/terminal\.visualstudio/i.test(src)) {
      command = resolveVsProfile(name);
    } else if (/terminal\.wsl/i.test(src)) {
      command = `wsl.exe -d "${name}"`;
    }
  }
  if (!command && !item.source) {
    command = name;
  }
  if (command && !localProfiles.some(p => p.name === name) && !hiddenProfiles.includes(name)) {
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
    if (raw) parseWtProfiles(raw);
    const fragments = await invoke<string[]>("read_wt_fragments");
    if (fragments && fragments.length > 0) parseWtFragments(fragments);
  } catch (e) {
    console.error("Failed to load WT profiles:", e);
  }
}

// ── config persistence ─────────────────────────────────────────────

function readConfigValues(cfg: any) {
  if (cfg.defaultLocalProfile) defaultLocalProfile = cfg.defaultLocalProfile;
  if (typeof cfg.fontFamily === "string") configFontFamily = cfg.fontFamily;
  if (typeof cfg.fontSize === "number" && cfg.fontSize >= 10 && cfg.fontSize <= 32) configFontSize = cfg.fontSize;
  if (Array.isArray(cfg.hiddenProfiles)) hiddenProfiles = cfg.hiddenProfiles;
}

export async function loadConfig() {
  try {
    const raw = await invoke<string>("read_config");
    const cfg = JSON.parse(raw);
    readConfigValues(cfg);
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
// exposed for settings page
(window as any).setDefaultProfile = setDefaultProfile;
