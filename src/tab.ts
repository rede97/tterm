import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebglAddon } from "@xterm/addon-webgl";
import { invoke } from "@tauri-apps/api/core";
import { TabType } from "./types";
import { SshHost, configFontFamily, configFontSize } from "./profiles";

/**
 * Hysteresis comparator — like a Schmitt trigger in circuits.
 * Prevents oscillation by only changing output when the input crosses
 * a threshold.
 *
 *   floatVal  — continuous value (e.g. 107.3 cols would fit)
 *   current   — current discrete value  (e.g. 107 cols)
 *   shrinkTh  — shrink when (float - current) < shrinkTh
 *   growTh    — grow   when (float - current) > growTh
 *   min       — floor clamp
 */
function hysteresis(
  floatVal: number, current: number,
  shrinkTh: number, growTh: number, min: number,
): number {
  const gap = floatVal - current;
  if (gap < shrinkTh) return Math.max(min, Math.floor(floatVal));
  if (gap > growTh)   return Math.max(min, Math.floor(floatVal));
  return current;
}

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

  /**
   * Pure calculation: how many rows/cols fit in the current container.
   * No dead zone, no oscillation — just available space / char size.
   */
  fit(): { cols: number; rows: number } {
    if (!this.charWidth || !this.charHeight) {
      // first time — measure from xterm
      const core = (this.terminal as any)._core;
      const dims = core._renderService.dimensions;
      if (dims && dims.css.cell.width > 0) {
        this.charWidth = dims.css.cell.width;
        this.charHeight = dims.css.cell.height;
      } else {
        return { cols: this.terminal.cols, rows: this.terminal.rows };
      }
    }

    const parent = this.element.parentElement!;
    const ps = getComputedStyle(parent);
    const parentH = parseFloat(ps.height);
    const parentW = parseFloat(ps.width);

    const xs = getComputedStyle(this.terminal.element!);
    let padH = parseFloat(xs.paddingLeft) + parseFloat(xs.paddingRight);
    const vp = this.terminal.element!.querySelector(".xterm-viewport");
    if (vp) padH += parseFloat(getComputedStyle(vp).paddingRight) || 0;
    const padV = parseFloat(xs.paddingTop) + parseFloat(xs.paddingBottom);

    const floatCols = (parentW - padH) / this.charWidth;
    const floatRows = (parentH - padV) / this.charHeight;

    const cols = hysteresis(floatCols, this.terminal.cols, -0.2, 0.9, 2);
    const rows = hysteresis(floatRows, this.terminal.rows, -0.2, 0.9, 2);

    if (this.terminal.cols !== cols || this.terminal.rows !== rows)
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
