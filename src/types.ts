import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { SshHost } from "./profiles";

export interface PtyOutputPayload {
  id: string;
  data: string; // base64-encoded PTY bytes
}

export type TabType = "local" | "ssh";

export interface Tab {
  id: string;
  terminal: Terminal;
  fitAddon: FitAddon;
  searchAddon: SearchAddon;
  element: HTMLElement;
  tabElement: HTMLElement;
  xtermEl: HTMLElement;
  charWidth: number;
  charHeight: number;
  type: TabType;
  command?: string;
  sshHost?: SshHost;
  label: string;
  color?: string;
  needsResize: boolean;
}
