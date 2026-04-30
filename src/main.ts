import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

import "@xterm/xterm/css/xterm.css";

const term = new Terminal({
  cursorBlink: true,
  fontSize: 14,
  fontFamily: 'Consolas, "Courier New", monospace',
  theme: {
    background: "#1e1e1e",
    foreground: "#d4d4d4",
    cursor: "#ffffff",
    selectionBackground: "#264f78",
    black: "#000000",
    red: "#cd3131",
    green: "#0dbc79",
    yellow: "#e5e510",
    blue: "#2472c8",
    magenta: "#bc3fbc",
    cyan: "#11a8cd",
    white: "#e5e5e5",
    brightBlack: "#666666",
    brightRed: "#f14c4c",
    brightGreen: "#23d18b",
    brightYellow: "#f5f543",
    brightBlue: "#3b8eea",
    brightMagenta: "#d670d6",
    brightCyan: "#29b8db",
    brightWhite: "#ffffff",
  },
});

const fitAddon = new FitAddon();
term.loadAddon(fitAddon);
term.open(document.getElementById("terminal")!);
fitAddon.fit();

// Forward user input to Rust backend (PTY stdin)
term.onData((data) => {
  invoke("pty_write", { data });
});

// Receive PTY output from Rust backend
listen<number[]>("pty-output", (event) => {
  const bytes = new Uint8Array(event.payload);
  term.write(bytes);
});

// Handle terminal resize
term.onResize(({ cols, rows }) => {
  invoke("pty_resize", { cols, rows });
});

// Handle window resize
window.addEventListener("resize", () => {
  fitAddon.fit();
});

// Focus the terminal on launch
term.focus();
