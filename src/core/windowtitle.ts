// Window title reporting for the tray menu. The tray (backend) needs a
// meaningful per-window title — the active tab's label — to list hidden
// windows. OSC title sequences can fire per prompt, so reports are
// debounced (trailing edge): at most one IPC every 400 ms.

import { invoke } from "@tauri-apps/api/core";
import { logCatch } from "./errorlog";

let timer: ReturnType<typeof setTimeout> | null = null;
let pending = "";

export function reportWindowTitle(title: string): void {
  pending = title.trim() || "TTerm";
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    invoke("tray_set_title", { title: pending }).catch(logCatch("tray.setTitle"));
  }, 400);
}
