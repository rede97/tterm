declare module "@xterm/addon-attach" {
  import { Terminal, ITerminalAddon } from "@xterm/xterm";
  export class AttachAddon implements ITerminalAddon {
    constructor(socket: WebSocket, options?: { bidirectional?: boolean });
    activate(terminal: Terminal): void;
    dispose(): void;
  }
}
