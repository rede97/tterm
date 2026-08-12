// Windows Terminal profile and theme scheme parsing.
// Reads WT settings.json and fragment files via Tauri IPC.

import { invoke } from "@tauri-apps/api/core";
import { logError } from "../core/errorlog";
import type { LocalProfile, SerialPort, VsInstallation } from "../core/types";
import type { ThemeDef } from "../util/themes";
import { parseWtSchemes } from "../util/themes";

export interface WtLoadResult {
  profiles: LocalProfile[];
  themes: ThemeDef[];
  vsInstalls: VsInstallation[];
}

function resolveVsProfile(name: string, vsInstalls: VsInstallation[]): string | null {
  if (vsInstalls.length === 0) return null;
  const yearMatch = name.match(/\b(20\d\d)\b/);
  const year = yearMatch ? yearMatch[1] : null;
  const vs = year ? vsInstalls.find((v) => v.path.includes(year)) || vsInstalls[0] : vsInstalls[0];
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

function addProfile(item: any, localProfiles: LocalProfile[], vsInstalls: VsInstallation[]): void {
  if (item.hidden) return;
  const src = (item.source || "") as string;
  const name: string | null | undefined = item.name;
  if (!name) return;
  let command: string | null | undefined = item.commandline;
  if (!command) {
    if (/terminal\.visualstudio/i.test(src)) {
      command = resolveVsProfile(name, vsInstalls);
    } else if (/terminal\.wsl/i.test(src)) {
      command = `wsl.exe -d "${name}"`;
    } else if (/terminal\.azure/i.test(src)) {
      command = `wt.exe -p "${name}"`;
    }
  }
  if (!command && !item.source) {
    command = name;
  }
  if (command && !localProfiles.some((p) => p.name === name)) {
    localProfiles.push({ name, command });
  }
}

function parseProfilesFromJson(
  root: any,
  localProfiles: LocalProfile[],
  vsInstalls: VsInstallation[],
): void {
  const list: any[] = root?.profiles?.list;
  if (list) {
    for (const item of list) addProfile(item, localProfiles, vsInstalls);
    return;
  }
  const arr: any[] = root?.profiles;
  if (arr) {
    for (const item of arr) addProfile(item, localProfiles, vsInstalls);
  }
}

/** Load VS installations, WT profiles, and theme schemes in one call. */
export async function loadAllWtData(): Promise<WtLoadResult> {
  let vsInstalls: VsInstallation[] = [];
  try {
    vsInstalls = await invoke<VsInstallation[]>("find_vs_instances");
  } catch (e) {
    logError("vs.findInstances", e);
  }

  const localProfiles: LocalProfile[] = [];
  let themes: ThemeDef[] = [];
  let raw: string | null = null;

  try {
    raw = await invoke<string | null>("read_wt_settings");
    if (raw) {
      try {
        parseProfilesFromJson(JSON.parse(raw), localProfiles, vsInstalls);
      } catch (e) {
        logError("wt.parseProfiles", e);
      }
      themes = parseWtSchemes(raw);
    }
    const fragments = await invoke<string[]>("read_wt_fragments");
    if (fragments && fragments.length > 0) {
      for (const frag of fragments) {
        try {
          parseProfilesFromJson(JSON.parse(frag), localProfiles, vsInstalls);
        } catch {
          /* skip malformed fragments */
        }
      }
    }
  } catch (e) {
    logError("wt.load", e);
  }

  return { profiles: localProfiles, themes, vsInstalls };
}

// ---- Serial port enumeration ----

export async function loadSerialPorts(): Promise<SerialPort[]> {
  try {
    return await invoke<SerialPort[]>("serial_list_ports");
  } catch (e) {
    logError("serial.listPorts", e);
    return [];
  }
}
