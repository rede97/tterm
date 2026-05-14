import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebglAddon } from "@xterm/addon-webgl";
import { invoke } from "@tauri-apps/api/core";
import { TabType } from "./types";
import { SshHost, configFontFamily, configFontSize } from "./profiles";

export class TerminalTab {
  id: string;
  terminal: Terminal;
  fitAddon: FitAddon;
  searchAddon: SearchAddon;
  element: HTMLElement;
  tabElement!: HTMLElement;
  xtermEl: HTMLElement;
  charWidth = 0;
  charHeight = 0;
  type: TabType;
  command?: string;
  sshHost?: SshHost;
  label: string;
  color?: string;
  needsResize = false;
  index = 0;
  searchQuery = "";

  constructor(id: string, type: TabType, label: string, container: HTMLElement) {
    this.id = id;
    this.type = type;
    this.label = label;

    this.element = document.createElement("div");
    this.element.className = "terminal-instance";
    this.element.style.display = "none";
    container.appendChild(this.element);

    this.terminal = new Terminal({
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

    this.fitAddon = new FitAddon();
    this.terminal.loadAddon(this.fitAddon);
    this.searchAddon = new SearchAddon();
    this.terminal.loadAddon(this.searchAddon);
    this.terminal.loadAddon(new WebglAddon());
    this.terminal.open(this.element);

    this.xtermEl = this.element.querySelector(".xterm") as HTMLElement;

    // right-click: copy/paste normally, shift+right-click for context menu
    // use capture phase so this fires before xterm.js internal handler
    this.element.addEventListener("contextmenu", (e: MouseEvent) => {
      if (e.shiftKey) {
        e.preventDefault();
        e.stopImmediatePropagation();
        this._showContextMenu(e.clientX, e.clientY);
        return;
      }
      e.preventDefault();
      const sel = this.terminal.getSelection();
      if (sel.length > 0) {
        const ta = document.createElement("textarea");
        ta.value = sel;
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        this.terminal.clearSelection();
      } else {
        navigator.clipboard.readText().then(t => {
          if (t) this.terminal.paste(t);
        }).catch(() => {});
      }
    }, true);
  }

  show(): void {
    this.element.style.display = "";
    this.tabElement.classList.add("active");
    this.terminal.focus();
  }

  hide(): void {
    this.element.style.display = "none";
    this.tabElement.classList.remove("active");
    this.needsResize = true;
  }

  fit(): { cols: number; rows: number } {
    const addon = this.fitAddon as any;
    const proposed: { cols: number; rows: number } | undefined = addon.proposeDimensions?.();
    if (!proposed) {
      this.fitAddon.fit();
      return { cols: this.terminal.cols, rows: this.terminal.rows };
    }

    const core = (this.terminal as any)._core;
    const dims = core._renderService.dimensions;
    if (!dims || dims.css.cell.width === 0 || dims.css.cell.height === 0) {
      return { cols: this.terminal.cols, rows: this.terminal.rows };
    }

    const charH = dims.css.cell.height;
    const charW = dims.css.cell.width;
    const toleranceV = Math.max(1, Math.round(charH * 0.1));
    const toleranceH = Math.max(1, Math.round(charW * 0.1));

    const parent = this.terminal.element!.parentElement!;
    const parentStyle = getComputedStyle(parent);
    const parentH = parseFloat(parentStyle.getPropertyValue("height"));
    const xtermStyle = getComputedStyle(this.terminal.element!);
    const paddingV =
      parseFloat(xtermStyle.paddingTop) + parseFloat(xtermStyle.paddingBottom);
    const paddingH =
      parseFloat(xtermStyle.paddingLeft) + parseFloat(xtermStyle.paddingRight);
    const availableH = parentH - paddingV;
    const availableW =
      parseFloat(parentStyle.getPropertyValue("width")) - paddingH;

    let rows = proposed.rows;
    if (this.terminal.rows > proposed.rows) {
      const overflow = this.terminal.rows * charH - availableH;
      if (overflow > 0 && overflow <= toleranceV) rows = this.terminal.rows;
    }

    let cols = Math.max(2, proposed.cols);
    if (this.terminal.cols > proposed.cols) {
      const overflow = this.terminal.cols * charW - availableW;
      if (overflow > 0 && overflow <= toleranceH) cols = this.terminal.cols;
    }

    if (this.terminal.rows !== rows || this.terminal.cols !== cols)
      this.terminal.resize(cols, rows);

    return { cols, rows };
  }

  fitDeferred(): void {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (this.element.style.display === "none") return;
        const { cols, rows } = this.fit();
        this.charWidth = this.xtermEl.clientWidth / cols;
        this.charHeight = this.xtermEl.clientHeight / rows;
        this.needsResize = false;
        invoke("pty_resize", { id: this.id, cols, rows }).catch(() => {});
      });
    });
  }

  setColor(color?: string): void {
    this.color = color;
    const badge = this.tabElement.querySelector(".tab-badge") as HTMLElement;
    if (color) {
      this.tabElement.style.borderLeft = `3px solid ${color}`;
      this.tabElement.style.paddingLeft = "9px";
      if (badge) badge.style.color = color;
    } else {
      this.tabElement.style.borderLeft = "";
      this.tabElement.style.paddingLeft = "";
      if (badge) badge.style.color = "";
    }
  }

  rename(newName: string): void {
    this.label = newName.trim();
    this.command = undefined;
    const labelEl = this.tabElement.querySelector(".tab-label") as HTMLElement;
    if (labelEl) labelEl.textContent = this.label;
  }

  destroy(): void {
    this.element.remove();
    this.tabElement.remove();
    this.terminal.dispose();
  }

  private _showContextMenu(x: number, y: number): void {
    import("./contextmenu").then(m => m.showTerminalContextMenu(this.id, x, y));
  }
}
