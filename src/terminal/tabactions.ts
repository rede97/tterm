// Per-tab user actions — rename (inline edit), AI share, clear, duplicate,
// export scrollback, and batch closes. Extracted from TabManager; each takes
// the manager (type-only import, no runtime cycle) and drives the shared UI
// pieces (toast / quick button) itself.

import { invoke } from "@tauri-apps/api/core";
import { writeText as clipboardWriteText } from "@tauri-apps/plugin-clipboard-manager";
import { logCatch } from "../core/errorlog";
import { showToast } from "../ui/toast";
import { updateQuickButton } from "./quickpanel";
import type { TabManager } from "./tabmanager";

export function renameTab(mgr: TabManager, id: string): void {
  const tab = mgr.tabs.get(id);
  if (!tab) return;
  const labelEl = tab.tabElement.querySelector(".tab-label") as HTMLElement | null;
  if (!labelEl || labelEl.querySelector("input")) return;

  // Inline editing: the native prompt() dialog shows the dev URL as its
  // title ("127.0.0.1:1420 says…") and looks foreign to the app.
  const input = document.createElement("input");
  input.className = "tab-rename-input";
  input.value = tab.label;
  labelEl.textContent = "";
  labelEl.appendChild(input);

  // Editing must not trigger tab switching or SortableJS drag.
  for (const ev of ["click", "dblclick", "mousedown", "pointerdown"]) {
    input.addEventListener(ev, (e) => e.stopPropagation());
  }

  let done = false;
  const finish = (save: boolean) => {
    if (done) return;
    done = true;
    const name = input.value.trim();
    if (save && name && name !== tab.label) {
      tab.rename(name); // also locks the OSC title
    } else if (save && !name && tab.titleLocked) {
      tab.resetTitle(); // emptied: back to tracking the terminal title
    } else {
      labelEl.textContent = tab.label;
    }
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      finish(true);
    } else if (e.key === "Escape") {
      e.preventDefault();
      finish(false);
    }
    e.stopPropagation();
  });
  input.addEventListener("blur", () => finish(true));

  input.focus();
  input.select();
}

export async function shareTab(mgr: TabManager, id: string): Promise<void> {
  const tab = mgr.tabs.get(id);
  if (!tab) return;
  if (tab.shared) {
    await invoke("share_revoke", { id }).catch(logCatch("share.revoke"));
    tab.shared = false;
    tab.shareUrl = undefined;
    tab.tabElement.classList.remove("shared");
    updateQuickButton();
    return;
  }
  try {
    const res = await invoke<{ url: string }>("share_create", {
      id,
      label: tab.label,
      kind: tab.type,
      allowWrite: true,
    });
    await clipboardWriteText(res.url).catch(logCatch("clipboard.write"));
    tab.shared = true;
    tab.shareUrl = res.url;
    tab.tabElement.classList.add("shared");
    updateQuickButton();
  } catch (e) {
    showToast(`Failed to share session: ${e}`, "error");
  }
}

export function clearTab(mgr: TabManager, id: string): void {
  mgr.tabs.get(id)?.terminal.clear();
}

export async function duplicateTab(mgr: TabManager, id: string): Promise<void> {
  const tab = mgr.tabs.get(id);
  if (!tab) return;
  if (tab.type === "ssh" && tab.sshHost) {
    await mgr.createSshTab(tab.sshHost);
  } else if (tab.type === "serial" && tab.serialPort) {
    // Same device; profile/baud re-read from the current defaults.
    await mgr.createSerialTab(tab.serialPort);
  } else if (tab.command) {
    await mgr.createLocalTab(tab.command, tab.label);
  } else {
    await mgr.createLocalTab(undefined, tab.label);
  }
}

export function exportTab(mgr: TabManager, id: string): void {
  const tab = mgr.tabs.get(id);
  if (!tab) return;
  const buffer = tab.terminal.buffer.active;
  const lines: string[] = [];
  for (let y = 0; y < buffer.length; y++) {
    const line = buffer.getLine(y);
    if (line) lines.push(line.translateToString().trimEnd());
  }
  invoke("save_text_file", { content: lines.join("\n") }).catch(logCatch("tab.export"));
}

export function closeTabsRight(mgr: TabManager, id: string): void {
  const idx = mgr.getTabIndex(id);
  if (idx === -1) return;
  const ids = Array.from(mgr.tabs.keys()).filter((tid) => mgr.getTabIndex(tid) > idx);
  for (const tid of ids) mgr.closeTab(tid);
}

export function closeOtherTabs(mgr: TabManager, id: string): void {
  const ids = Array.from(mgr.tabs.keys()).filter((tid) => tid !== id);
  for (const tid of ids) mgr.closeTab(tid);
}
