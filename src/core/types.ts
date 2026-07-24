// Shared type definitions — pure types only, no runtime code.

export type TabType = "local" | "ssh" | "serial";
export type SerialInputMode = "normal" | "echo" | "line";
export type SerialEnterNewline = "cr" | "lf" | "crlf";
export type SerialOutputNewline = "keep" | "cr-in-lf" | "lf-in-cr" | "force-crlf" | "force-lf" | "force-cr" | "strip";

export interface SshHost {
  name: string;
  [key: string]: string;
}

export interface LocalProfile {
  name: string;
  command: string;
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
