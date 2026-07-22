import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebglAddon } from "@xterm/addon-webgl";
import { invoke } from "@tauri-apps/api/core";
import { TabType } from "./types";
import { hysteresis } from "./hysteresis";
import { SshHost, configFontFamily, configFontSize, configRenderer, configScrollback, trimPasteContent } from "./profiles";

export class TerminalTab {
  id: string;
  terminal: Terminal;
  fitAddon: FitAddon;
  searchAddon: SearchAddon;
  element: HTMLElement;
  tabElement!: HTMLElement;
  xtermEl: HTMLElement;
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
      allowProposedApi: true,
      cursorBlink: true,
      fontSize: configFontSize,
      fontFamily: configFontFamily,
      scrollback: configScrollback,
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
    if (configRenderer === "webgl") this.terminal.loadAddon(new WebglAddon());
    this.terminal.open(this.element);

    this.terminal.onTitleChange((title: string) => {
      if (title) {
        this.label = title;
        const labelEl = this.tabElement.querySelector(".tab-label") as HTMLElement;
        if (labelEl) labelEl.textContent = title;
      }
    });

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
          if (t) this.terminal.paste(trimPasteContent(t));
        }).catch(() => { });
      }
    }, true);

    // Freeze IME textarea position during composition to prevent candidate window drift.
    this._patchImeFreeze();
  }

  private _patchImeFreeze(): void {
    // Intercept the hidden textarea's style setter to freeze left/top during IME composition.
    // Strategy: locate xterm.js's internal textarea via _core.textarea, then replace
    // the style object's `left` and `top` setters. When composition is active, all
    // writes are redirected to frozen pixel coordinates captured at compositionstart.
    let left: number | null = null;
    let top: number | null = null;

    const core = (this.terminal as any)._core;

    // Need to wait for xterm.open() to complete before _core.textarea exists.
    // open() runs synchronously in the constructor above, so it's safe here.
    const ta: HTMLTextAreaElement | undefined = core.textarea;
    if (!ta) return;

    // Replace `ta.style` with a Proxy whose setters for left/top/width are
    // clamped during IME composition.
    const origStyle = ta.style;
    const proxyHandler: ProxyHandler<CSSStyleDeclaration> = {
      set(target, prop, value, receiver) {
        if (left !== null && top !== null) {
          if (prop === "left") {
            return Reflect.set(target, prop, left + "px", receiver);
          }
          if (prop === "top") {
            return Reflect.set(target, prop, top + "px", receiver);
          }
          // Prevent xterm.js from setting width to a huge value (screen width).
          // Clamp to one cell width so IME candidate window stays at correct position.
          if (prop === "width") {
            const dims = core._renderService?.dimensions?.css;
            const cellW = dims?.cell?.width ?? 8;
            return Reflect.set(target, prop, Math.max(cellW, 1) + "px", receiver);
          }
        }
        return Reflect.set(target, prop, value, receiver);
      }
    };

    // Override the textarea's style property descriptor so that every
    // `this._textarea.style.left = ...` call in xterm.js goes through our proxy.
    Object.defineProperty(ta, "style", {
      get() { return new Proxy(origStyle, proxyHandler); },
      set(_v: CSSStyleDeclaration) { /* ignore */ },
      configurable: true,
    });

    // compositionstart/end: capture the frozen anchor position.
    // These fire on the hidden textarea and bubble through document.
    document.addEventListener("compositionstart", () => {
      const buf = this.terminal.buffer.active;
      const dims = core._renderService?.dimensions?.css;
      const cellW = dims?.cell?.width ?? 8;
      const cellH = dims?.cell?.height ?? 16;
      left = (buf.cursorX - 1) * cellW;
      top = buf.cursorY * cellH;
    }, true);

    document.addEventListener("compositionend", () => {
      left = null;
      top = null;
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
   * No dead zone, no oscillation just available space / char size.
   */
  fit(): { cols: number; rows: number } {
    const core = (this.terminal as any)._core;
    const dims = core._renderService.dimensions;
    const charWidth = dims.css.cell.width;
    const charHeight = dims.css.cell.height;

    const parent = this.element.parentElement!;
    const ps = getComputedStyle(parent);
    const parentH = parseFloat(ps.height);
    const parentW = parseFloat(ps.width);

    const xs = getComputedStyle(this.terminal.element!);
    let padH = parseFloat(xs.paddingLeft) + parseFloat(xs.paddingRight);
    // xterm-screen padding-right = scrollbar safe area
    const scr = this.terminal.element!.querySelector(".xterm-screen");
    if (scr) padH += parseFloat(getComputedStyle(scr).paddingRight) || 0;
    const padV = parseFloat(xs.paddingTop) + parseFloat(xs.paddingBottom);

    const floatCols = (parentW - padH) / charWidth;
    const floatRows = (parentH - padV) / charHeight;

    const cols = hysteresis(floatCols, this.terminal.cols, 0.8, 0.9);
    const rows = hysteresis(floatRows, this.terminal.rows, 0.98, 1.0);

    if (this.terminal.cols !== cols || this.terminal.rows !== rows)
      this.terminal.resize(cols, rows);

    return { cols, rows };
  }

  fitDeferred(): void {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (this.element.style.display === "none") return;
        const { cols, rows } = this.fit();
        this.needsResize = false;
        invoke("pty_resize", { id: this.id, cols, rows }).catch(() => { });
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


