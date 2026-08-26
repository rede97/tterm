// Shared type definitions — pure types only, no runtime code.

export type TabType = "local" | "ssh" | "serial";
export type SerialInputMode = "normal" | "echo" | "line";
export type SerialEnterNewline = "cr" | "lf" | "crlf";
export type SerialOutputNewline =
  | "keep"
  | "cr-in-lf"
  | "lf-in-cr"
  | "force-crlf"
  | "force-lf"
  | "force-cr"
  | "strip";

export interface SshHost {
  name: string;
  [key: string]: string;
}

export interface LocalProfile {
  name: string;
  command: string;
}

// Backend session-spawn result: hub endpoint + auth token for the WS attach.
export interface WsConnectResult {
  id: string;
  port: number;
  token: string;
}

export interface VsInstallation {
  path: string;
  version: string;
  instance_id?: string | null;
}

export interface SerialPort {
  name: string;
  driver: string;
  manufacturer: string;
  product: string;
  vid: string;
  pid: string;
}

export interface SerialParams {
  baud: number;
  inputMode?: SerialInputMode;
  outputNewline?: SerialOutputNewline;
  enterNewline?: SerialEnterNewline;
}

export type SerialFlowControl = "none" | "software" | "hardware";

/** Link frame for new serial sessions: 8 data bits · parity · 1 stop. */
export type SerialFrame = "8N1" | "8E1" | "8O1";

// A named serial session mode (built-in or user-defined). Baud and live
// flow control are link parameters, not session modes: a running session's
// profile switch must not touch them. flowControl is stored for custom
// profiles as the open-time default only.
export interface SerialProfile {
  name: string;
  inputMode: SerialInputMode;
  enterNewline: SerialEnterNewline;
  outputNewline: SerialOutputNewline;
  flowControl: SerialFlowControl;
}
