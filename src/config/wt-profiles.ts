// Windows Terminal profile parsing (shells / VS / WSL). Color schemes
// are not imported — the Appearance gallery is built-in + custom only.

import { invoke } from "@tauri-apps/api/core";
import { logError, swallow } from "../core/errorlog";
import type { LocalProfile, SerialPort, VsInstallation } from "../core/types";

export interface WtLoadResult {
  profiles: LocalProfile[];
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

function addProfile(
  item: unknown,
  localProfiles: LocalProfile[],
  vsInstalls: VsInstallation[],
): void {
  // WT settings.json is external input — narrow the few fields each profile
  // needs instead of trusting a hand-written shape.
  if (typeof item !== "object" || item === null) return;
  const p = item as Record<string, unknown>;
  if (p.hidden) return;
  const src = typeof p.source === "string" ? p.source : "";
  const name = typeof p.name === "string" && p.name !== "" ? p.name : null;
  if (!name) return;
  let command = typeof p.commandline === "string" && p.commandline !== "" ? p.commandline : null;
  if (!command) {
    if (/terminal\.visualstudio/i.test(src)) {
      command = resolveVsProfile(name, vsInstalls);
    } else if (/terminal\.wsl/i.test(src)) {
      command = `wsl.exe -d "${name}"`;
    } else if (/terminal\.azure/i.test(src)) {
      command = `wt.exe -p "${name}"`;
    }
  }
  if (!command && !src) {
    command = name;
  }
  if (command && !localProfiles.some((p) => p.name === name)) {
    localProfiles.push({ name, command });
  }
}

function parseProfilesFromJson(
  root: unknown,
  localProfiles: LocalProfile[],
  vsInstalls: VsInstallation[],
): void {
  if (typeof root !== "object" || root === null) return;
  const profiles = (root as Record<string, unknown>).profiles;
  if (typeof profiles === "object" && profiles !== null) {
    const list = (profiles as Record<string, unknown>).list;
    if (Array.isArray(list)) {
      for (const item of list) addProfile(item, localProfiles, vsInstalls);
      return;
    }
  }
  if (Array.isArray(profiles)) {
    for (const item of profiles) addProfile(item, localProfiles, vsInstalls);
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
  let raw: string | null = null;

  try {
    raw = await invoke<string | null>("read_wt_settings");
    if (raw) {
      try {
        parseProfilesFromJson(JSON.parse(raw), localProfiles, vsInstalls);
      } catch (e) {
        logError("wt.parseProfiles", e);
      }
    }
    const fragments = await invoke<string[]>("read_wt_fragments");
    if (fragments && fragments.length > 0) {
      for (const frag of fragments) {
        try {
          parseProfilesFromJson(JSON.parse(frag), localProfiles, vsInstalls);
        } catch {
          swallow(); // skip malformed fragments
        }
      }
    }
  } catch (e) {
    logError("wt.load", e);
  }

  return { profiles: localProfiles, vsInstalls };
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
