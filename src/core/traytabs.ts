// Tray tab reporting. The shared system tray lists each parked window as
// "TTerm#N" with its tab labels in a submenu — so the backend needs this
// window's full tab list, plus the active label for the native title.
// OSC title sequences can fire per prompt, so reports are debounced
// (trailing edge): at most one IPC every 400 ms.
//
// TabManager registers the provider (it owns the tabs map); TerminalTab
// calls notifyTrayTabs() on label changes (rename / OSC title).

import { invoke } from "@tauri-apps/api/core";
import { logCatch } from "./errorlog";

let provider: (() => { tabs: string[]; active: string }) | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

export function setTrayTabsProvider(fn: () => { tabs: string[]; active: string }): void {
  provider = fn;
}

export function notifyTrayTabs(): void {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    if (!provider) return;
    const { tabs, active } = provider();
    invoke("tray_set_tabs", { tabs, active }).catch(logCatch("tray.setTabs"));
  }, 400);
}
