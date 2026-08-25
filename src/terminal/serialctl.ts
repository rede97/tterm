// Live parameter control for open SERIAL sessions — strictly session-only:
// the quick panel never persists anything; defaults live in Settings →
// Serial. Extracted from TabManager — these functions operate purely on the
// tab object + backend IPC, no manager internals.
//
//   setSerialProfile        apply a named profile to this session
//   setSerialBaud           live baud switch (backend) + tab-label refresh
//   setSerialInputMode      frontend input modes (normal/echo/line)
//   setSerialEnterNewline   frontend Enter terminator
//   setSerialOutputNewline  backend output newline

import { invoke } from "@tauri-apps/api/core";
import { findSerialProfile } from "../config/serial-profiles";
import type { SerialEnterNewline, SerialInputMode, SerialOutputNewline } from "../core/types";
import type { TerminalTab } from "./tab";

function serialTab(tab: TerminalTab | undefined): TerminalTab | undefined {
  return tab?.type === "serial" ? tab : undefined;
}

// Apply a profile to a live serial session: input mode + Enter terminator
// (frontend input handler) and output newline (backend). Flow control is
// a link setting like baud — the dedicated quick-panel control owns it,
// and a live profile switch must not touch it (PuTTY/Tabby keep RTS/CTS
// with the connection, not with newline/echo mode). The backend keeps the
// session spec in sync for output newline, so an in-band reconnect of THIS
// tab preserves the switch — but the global default profile is untouched
// (quick-panel changes never persist; defaults change in Settings only).
export async function setSerialProfile(tab: TerminalTab | undefined, name: string): Promise<void> {
  const t = serialTab(tab);
  if (!t) return;
  const profile = findSerialProfile(name);
  t.setSerialInputMode(profile.inputMode);
  t.setSerialEnterNewline(profile.enterNewline);
  await invoke("serial_set_output_newline", { id: t.id, mode: profile.outputNewline });
  t.outputNewline = profile.outputNewline;
  t.serialProfile = profile.name;
}

// Live Enter-key newline switch (frontend-side, this session only).
export async function setSerialEnterNewline(
  tab: TerminalTab | undefined,
  mode: SerialEnterNewline,
): Promise<void> {
  serialTab(tab)?.setSerialEnterNewline(mode);
}

// Live input-mode switch for an open serial session (this session only).
export function setSerialInputMode(tab: TerminalTab | undefined, mode: SerialInputMode): void {
  serialTab(tab)?.setSerialInputMode(mode);
}

// Live output-newline switch for an open serial session (this session only).
export async function setSerialOutputNewline(
  tab: TerminalTab | undefined,
  mode: SerialOutputNewline,
): Promise<void> {
  const t = serialTab(tab);
  if (!t) return;
  await invoke("serial_set_output_newline", { id: t.id, mode });
  t.outputNewline = mode;
}

// Live baud switch for an open serial session (this session only).
export async function setSerialBaud(tab: TerminalTab | undefined, baud: number): Promise<void> {
  const t = serialTab(tab);
  if (!t?.serialPortName) return;
  await invoke("serial_set_baud", { id: t.id, baudRate: baud });
  t.serialBaud = baud;
  // Baud display update, not a user rename — keep OSC title tracking live.
  t.rename(`${t.serialPortName} · ${baud}`, false);
}
