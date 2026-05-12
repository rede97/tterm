import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { configFontFamily, configFontSize } from "./profiles";
import { Tab } from "./types";

export function createTerminal(): {
  terminal: Terminal;
  fitAddon: FitAddon;
  searchAddon: SearchAddon;
  element: HTMLElement;
  xtermEl: HTMLElement;
} {
  const container = document.getElementById("terminal-container")!;
  const element = document.createElement("div");
  element.className = "terminal-instance";
  element.style.display = "none";
  container.appendChild(element);

  const terminal = new Terminal({
    cursorBlink: true,
    fontSize: configFontSize,
    fontFamily: configFontFamily,
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
  terminal.loadAddon(fitAddon);
  const searchAddon = new SearchAddon();
  terminal.loadAddon(searchAddon);
  terminal.open(element);

  return {
    terminal,
    fitAddon,
    searchAddon,
    element,
    xtermEl: element.querySelector(".xterm") as HTMLElement,
  };
}

export function applyFit(tab: Tab): { cols: number; rows: number } {
  const addon = tab.fitAddon as any;
  const proposed: { cols: number; rows: number } | undefined = addon.proposeDimensions?.();
  if (!proposed) {
    tab.fitAddon.fit();
    return { cols: tab.terminal.cols, rows: tab.terminal.rows };
  }

  const core = (tab.terminal as any)._core;
  const dims = core._renderService.dimensions;
  if (!dims || dims.css.cell.width === 0 || dims.css.cell.height === 0) {
    return { cols: tab.terminal.cols, rows: tab.terminal.rows };
  }

  const charH = dims.css.cell.height;
  const charW = dims.css.cell.width;
  const toleranceV = Math.max(1, Math.round(charH * 0.1));
  const toleranceH = Math.max(1, Math.round(charW * 0.1));

  const parent = tab.terminal.element!.parentElement!;
  const parentStyle = getComputedStyle(parent);
  const parentH = parseFloat(parentStyle.getPropertyValue("height"));
  const xtermStyle = getComputedStyle(tab.terminal.element!);
  const paddingV =
    parseFloat(xtermStyle.paddingTop) + parseFloat(xtermStyle.paddingBottom);
  const paddingH =
    parseFloat(xtermStyle.paddingLeft) + parseFloat(xtermStyle.paddingRight);
  const availableH = parentH - paddingV;
  const availableW =
    parseFloat(parentStyle.getPropertyValue("width")) - paddingH;

  let rows = proposed.rows;
  if (tab.terminal.rows > proposed.rows) {
    const overflow = tab.terminal.rows * charH - availableH;
    if (overflow > 0 && overflow <= toleranceV) rows = tab.terminal.rows;
  }

  let cols = Math.max(2, proposed.cols);
  if (tab.terminal.cols > proposed.cols) {
    const overflow = tab.terminal.cols * charW - availableW;
    if (overflow > 0 && overflow <= toleranceH) cols = tab.terminal.cols;
  }

  if (tab.terminal.rows !== rows || tab.terminal.cols !== cols)
    tab.terminal.resize(cols, rows);

  return { cols, rows };
}

let sizeHintTimer: ReturnType<typeof setTimeout> | null = null;

export function showSizeHint(cols: number, rows: number) {
  const overlay = document.getElementById("size-overlay");
  if (!overlay) return;
  overlay.textContent = `${cols} \xd7 ${rows}`;
  overlay.classList.add("visible");
  if (sizeHintTimer) clearTimeout(sizeHintTimer);
  sizeHintTimer = setTimeout(() => {
    overlay.classList.remove("visible");
  }, 1200);
}
