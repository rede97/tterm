// Serial port parameter memory — per-port remembered settings keyed by
// VID:PID for USB devices (stable across COM number changes) or port name.

import { configStore } from "../core/store";
import type { SerialPort, SerialParams } from "../core/types";

export function serialKeyFor(port: { name: string; vid: string; pid: string }): string {
  return port.vid && port.pid ? `usb:${port.vid}:${port.pid}` : `com:${port.name}`;
}

/** Effective params for a port: remembered values win, global defaults otherwise. */
export function serialParamsFor(port: SerialPort): Required<SerialParams> {
  const mem = configStore.get("serialPortParams")[serialKeyFor(port)];
  return {
    baud: mem?.baud ?? configStore.get("serialBaud"),
    inputMode: mem?.inputMode ?? configStore.get("serialInputMode"),
    outputNewline: mem?.outputNewline ?? configStore.get("serialOutputNewline"),
    enterNewline: mem?.enterNewline ?? configStore.get("serialEnterNewline"),
  };
}

/** Remember params for a port key (merges with existing). Persists to disk. */
export async function rememberSerialParams(key: string, params: Partial<SerialParams>): Promise<void> {
  const current = configStore.get("serialPortParams");
  const next = { ...current, [key]: { ...current[key], ...params } };
  configStore.set({ serialPortParams: next });
}

/** Forget remembered params for a port key. Persists to disk. */
export async function forgetSerialParams(key: string): Promise<void> {
  const current = { ...configStore.get("serialPortParams") };
  delete current[key];
  configStore.set({ serialPortParams: current });
}

/** Baud for opening a port: remembered value wins, global default otherwise. */
export function serialBaudFor(portName: string): number {
  return configStore.get("serialPortParams")[`com:${portName}`]?.baud ?? configStore.get("serialBaud");
}

export async function rememberSerialBaud(portName: string, baud: number): Promise<void> {
  await rememberSerialParams(`com:${portName}`, { baud });
}
