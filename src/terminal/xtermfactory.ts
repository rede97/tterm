// xterm instance construction — extracted from TerminalTab. Builds a Terminal
// with the current config, loads the standard addons (fit/search/webgl),
// wires clickable links, and opens it into its container. The caller keeps
// the OSC handlers and lifecycle (they reference the tab's own state).

import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";
import { findTheme } from "../util/themes";
import { setupTerminalLinks } from "./links";
import { shareLineState } from "./sharelines";

export interface XtermInstance {
  terminal: Terminal;
  fitAddon: FitAddon;
  searchAddon: SearchAddon;
}

export interface XtermConfig {
  fontSize: number;
  fontFamily: string;
  scrollback: number;
  themeName: string;
  renderer: string;
}

export function createXterm(container: HTMLElement, cfg: XtermConfig): XtermInstance {
  const terminal = new Terminal({
    allowProposedApi: true,
    cursorBlink: true,
    fontSize: cfg.fontSize,
    fontFamily: cfg.fontFamily,
    scrollback: cfg.scrollback,
    theme: findTheme(cfg.themeName).theme,
  });
  const fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);
  const searchAddon = new SearchAddon();
  terminal.loadAddon(searchAddon);
  // Clickable links: plain-click OSC 8 hyperlinks, Ctrl+click URLs.
  setupTerminalLinks(terminal);
  if (cfg.renderer === "webgl") terminal.loadAddon(new WebglAddon());
  // AI-share line addressing must see every trim from birth — attach before
  // any output can arrive.
  shareLineState(terminal);
  terminal.open(container);
  return { terminal, fitAddon, searchAddon };
}
