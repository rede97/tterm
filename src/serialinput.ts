import type { SerialInputMode } from "./profiles";

// Serial input modes:
//   normal — keystrokes go straight to the device
//   echo   — also echo printable input locally (many devices don't echo)
//   line   — buffer locally with echo + backspace editing, send on Enter
//
// send(): write bytes to the device socket
// echo(): write bytes into the local terminal

export function createSerialInputHandler(
  mode: SerialInputMode,
  send: (data: string) => void,
  echo: (data: string) => void,
): (data: string) => void {
  if (mode === "normal") {
    return (data) => send(data);
  }
  if (mode === "echo") {
    return (data) => {
      send(data);
      echo(data);
    };
  }
  // line-by-line with local editing
  let buf = "";
  return (data) => {
    for (const ch of data) {
      if (ch === "\r") {
        const line = buf;
        buf = "";
        send(line + "\r");
        echo("\r\n");
      } else if (ch === "\x7f" || ch === "\b") {
        if (buf.length > 0) {
          buf = buf.slice(0, -1);
          echo("\b \b");
        }
      } else if (ch === "\x03" || ch === "\x04" || ch === "\x1a") {
        // Ctrl+C / Ctrl+D / Ctrl+Z: send immediately, clear the line
        buf = "";
        send(ch);
      } else if (ch >= " " || ch === "\t") {
        buf += ch;
        echo(ch);
      }
      // other control bytes are swallowed while editing
    }
  };
}
