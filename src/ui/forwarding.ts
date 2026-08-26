// Port forwarding — manage local (-L) / remote (-R) / dynamic (-D)
// forwards for tabs running on the embedded SSH client
// (src-tauri/src/sshclient).
//
// The invoke calls AND their error toasts live here exactly once
// (listForwards / addForward / removeForward): the command palette
// (ui/palette.ts) and the quick panel (quickpanel.ts) are two views of
// the same operations and must give identical feedback. The standalone
// dialog was removed by design — forwards are edited in the palette
// overlay, never a separate window.

import { invoke } from "@tauri-apps/api/core";
import { showToast } from "./toast";

export interface ForwardInfo {
  forwardId: number;
  kind: string;
  listenHost: string;
  listenPort: number;
  targetHost: string;
  targetPort: number;
}

export interface NewForward {
  kind: string;
  listenHost: string;
  listenPort: number;
  targetHost: string;
  targetPort: number;
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// null on failure (toast already shown).
export async function listForwards(tabId: string): Promise<ForwardInfo[] | null> {
  try {
    return await invoke<ForwardInfo[]>("ssh_forward_list", { id: tabId });
  } catch (err) {
    showToast(`Failed to list port forwards: ${errText(err)}`, "error");
    return null;
  }
}

// Returns the backend forward id (needed later by removeForward); null on
// failure (toast already shown).
export async function addForward(tabId: string, forward: NewForward): Promise<number | null> {
  try {
    return await invoke<number>("ssh_forward_add", { id: tabId, ...forward });
  } catch (err) {
    showToast(`Failed to add port forward: ${errText(err)}`, "error");
    return null;
  }
}

export async function removeForward(tabId: string, forwardId: number): Promise<boolean> {
  try {
    await invoke("ssh_forward_remove", { id: tabId, forwardId });
    return true;
  } catch (err) {
    showToast(`Failed to remove port forward: ${errText(err)}`, "error");
    return false;
  }
}
