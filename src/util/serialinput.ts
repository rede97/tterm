import type { SerialInputMode, SerialEnterNewline } from "../core/types";

// Serial input modes:
//   normal — keystrokes go straight to the device
//   echo   — also echo printable input locally (many devices don't echo)
//   line   — buffer locally with echo + backspace editing, send on Enter
//
// enterNewline controls what the Enter key (and \r in pasted text) sends:
//   "cr" (default) / "lf" / "crlf" (e.g. AT-command devices)
//
// send(): write bytes to the device socket
// echo(): write bytes into the local terminal

const TERMINATORS: Record<SerialEnterNewline, string> = { cr: "\r", lf: "\n", crlf: "\r\n" };

export function createSerialInputHandler(
  mode: SerialInputMode,
  enterNewline: SerialEnterNewline,
  send: (data: string) => void,
  echo: (data: string) => void,
): (data: string) => void {
  const terminator = TERMINATORS[enterNewline];
  // ICRNL-style mapping: any pasted newline (\r\n, \r, or \n) becomes the
  // configured terminator — previously a bare \n bypassed the mapping and
  // went to the device as raw LF even in cr/crlf mode.
  const map = (data: string) => data.replace(/\r\n|\r|\n/g, terminator);

  if (mode === "normal") {
    return (data) => send(map(data));
  }
  if (mode === "echo") {
    return (data) => {
      send(map(data));
      echo(data);
    };
  }
  // line-by-line with local editing
  let buf = "";
  let skipLf = false; // the \n half of a \r\n pair must not submit twice
  return (data) => {
    for (const ch of data) {
      if (ch === "\n" && skipLf) {
        skipLf = false;
        continue;
      }
      skipLf = ch === "\r";
      if (ch === "\r" || ch === "\n") {
        // \n submits too: pasted multi-line text goes line by line instead
        // of being silently concatenated into one buffered line.
        const line = buf;
        buf = "";
        send(line + terminator);
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
