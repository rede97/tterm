// AI session sharing: session state introspection (/state) and the control
// plane (/control) for agents. Both round-trip through the share snapshot
// channel; this module is the frontend half. Actions reuse the exact
// setters the quick panel uses, so an agent's change is indistinguishable
// from a human's (same backend commands, same tab fields).
//
// Control is gated on the share being read-write — the backend rejects
// /control on read-only tokens before it ever reaches here.

import { invoke } from "@tauri-apps/api/core";
import type { NewForward } from "../ui/forwarding";
import {
  setSerialBaud,
  setSerialEnterNewline,
  setSerialInputMode,
  setSerialOutputNewline,
} from "./serialctl";
import type { TerminalTab } from "./tab";

const INPUT_MODES = ["normal", "echo", "line"];
const ENTER_NEWLINES = ["cr", "lf", "crlf"];
const OUTPUT_NEWLINES = [
  "keep",
  "cr-in-lf",
  "lf-in-cr",
  "force-crlf",
  "force-lf",
  "force-cr",
  "strip",
];
const FLOW_CONTROLS = ["none", "software", "hardware"];
const FORWARD_KINDS = ["local", "remote", "dynamic"];

/** GET /state: what the session is and how it's currently configured. */
export async function buildShareState(tab: TerminalTab): Promise<Record<string, unknown>> {
  const st: Record<string, unknown> = {
    id: tab.id,
    label: tab.label,
    type: tab.type,
    alive: !tab.disconnected,
  };
  if (tab.type === "serial") {
    st.serial = {
      port: tab.serialPortName,
      baud: tab.serialBaud,
      profile: tab.serialProfile,
      inputMode: tab.inputMode,
      enterNewline: tab.enterNewline,
      outputNewline: tab.outputNewline,
      flowControl: tab.flowControl,
    };
  }
  if (tab.type === "ssh" && tab.sshEmbedded) {
    try {
      st.forwards = await invoke("ssh_forward_list", { id: tab.id });
    } catch {
      st.forwards = null; // not an embedded session / backend rejected
    }
  }
  return st;
}

interface ForwardAction {
  action?: string;
  kind?: string;
  listenHost?: string;
  listenPort?: number;
  targetHost?: string;
  targetPort?: number;
  forwardId?: number;
}

interface ControlAction {
  serial?: {
    baud?: number;
    inputMode?: string;
    enterNewline?: string;
    outputNewline?: string;
    flowControl?: string;
    rts?: boolean;
    dtr?: boolean;
  };
  forward?: ForwardAction;
}

/** POST /control: apply one action object. Returns { ok, applied } or
 * { error }. Unknown/invalid fields are rejected, never silently ignored —
 * an agent must learn about typos immediately. */
export async function applyShareControl(
  tab: TerminalTab,
  action: ControlAction,
): Promise<Record<string, unknown>> {
  if (!action || typeof action !== "object") return { error: "expected a JSON object" };
  const applied: string[] = [];

  if (action.serial) {
    if (tab.type !== "serial") return { error: "not a serial session" };
    const s = action.serial;
    const bad = (k: string, v: unknown, allowed: readonly unknown[]) =>
      v !== undefined && !allowed.includes(v) ? `invalid ${k}: ${String(v)}` : null;
    const err =
      bad("inputMode", s.inputMode, INPUT_MODES) ??
      bad("enterNewline", s.enterNewline, ENTER_NEWLINES) ??
      bad("outputNewline", s.outputNewline, OUTPUT_NEWLINES) ??
      bad("flowControl", s.flowControl, FLOW_CONTROLS);
    if (err) return { error: err };
    if (s.baud !== undefined && (!Number.isInteger(s.baud) || s.baud < 300 || s.baud > 921600)) {
      return { error: `invalid baud: ${String(s.baud)}` };
    }

    // Serial setters run sequentially: partial application is visible in
    // `applied` if a later one throws.
    if (s.inputMode !== undefined) {
      setSerialInputMode(tab, s.inputMode as TerminalTab["inputMode"]);
      applied.push(`inputMode=${s.inputMode}`);
    }
    if (s.enterNewline !== undefined) {
      await setSerialEnterNewline(tab, s.enterNewline as TerminalTab["enterNewline"]);
      applied.push(`enterNewline=${s.enterNewline}`);
    }
    if (s.outputNewline !== undefined) {
      await setSerialOutputNewline(tab, s.outputNewline as never);
      applied.push(`outputNewline=${s.outputNewline}`);
    }
    if (s.flowControl !== undefined) {
      await invoke("serial_set_flow_control", { id: tab.id, flow: s.flowControl });
      tab.flowControl = s.flowControl;
      applied.push(`flowControl=${s.flowControl}`);
    }
    if (s.baud !== undefined) {
      await setSerialBaud(tab, s.baud);
      applied.push(`baud=${s.baud}`);
    }
    if (s.rts !== undefined) {
      await invoke("serial_set_rts", { id: tab.id, on: s.rts });
      applied.push(`rts=${s.rts}`);
    }
    if (s.dtr !== undefined) {
      await invoke("serial_set_dtr", { id: tab.id, on: s.dtr });
      applied.push(`dtr=${s.dtr}`);
    }
  }

  if (action.forward) {
    if (tab.type !== "ssh" || !tab.sshEmbedded) {
      return { error: "forwards require an embedded SSH session" };
    }
    const f: ForwardAction = action.forward;
    if (f.action === "add") {
      const kind = f.kind;
      const listenPort = f.listenPort;
      if (!kind || !FORWARD_KINDS.includes(kind)) {
        return { error: `invalid forward kind: ${String(f.kind)}` };
      }
      if (typeof listenPort !== "number" || !Number.isInteger(listenPort)) {
        return { error: "forward add needs listenPort" };
      }
      const spec: NewForward = {
        kind,
        listenHost: f.listenHost ?? "127.0.0.1",
        listenPort,
        targetHost: f.targetHost ?? "",
        targetPort: f.targetPort ?? 0,
      };
      const forwardId = await invoke<number>("ssh_forward_add", { id: tab.id, ...spec });
      applied.push(`forward ${f.kind} id=${forwardId}`);
      return { ok: true, applied, forwardId };
    }
    if (f.action === "remove") {
      if (!Number.isInteger(f.forwardId)) return { error: "forward remove needs forwardId" };
      await invoke("ssh_forward_remove", { id: tab.id, forwardId: f.forwardId });
      applied.push(`forward removed id=${f.forwardId}`);
    } else if (f.action !== undefined) {
      return { error: `invalid forward action: ${String(f.action)}` };
    } else {
      return { error: "forward needs action: add|remove" };
    }
  }

  if (applied.length === 0) return { error: "nothing to apply" };
  return { ok: true, applied };
}
