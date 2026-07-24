import { Terminal, IDisposable, IBufferCell } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebglAddon } from "@xterm/addon-webgl";
import { invoke } from "@tauri-apps/api/core";
import { readText as clipboardReadText, writeText as clipboardWriteText } from "@tauri-apps/plugin-clipboard-manager";
import { logCatch } from "../core/errorlog";
import type { TabType } from "../core/types";
import { hysteresis } from "../util/hysteresis";
import { parseOsc9Progress, applyProgressToTabElement } from "../util/osc";
import { SizeHint } from "../util/sizehint";
import { DisconnectOverlay } from "../util/disconnect";
import { ImeBox } from "../util/imebox";
import { CursorPositionFilter } from "../util/imefilter";
import type { SshHost, SerialInputMode, SerialEnterNewline } from "../core/types";
import { trimPasteContent } from "../core/common";
import { configStore } from "../core/store";
import { createSerialInputHandler } from "../util/serialinput";
import { findTheme } from "../util/themes";

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
  serialPortName?: string;
  serialKey?: string;
  serialBaud?: number;
  outputNewline?: string;
  inputMode: SerialInputMode = "normal";
  enterNewline: SerialEnterNewline = "cr";
  label: string;
  color?: string;
  needsResize = false;
  index = 0;
  searchQuery = "";
  progressState = 0;
  progress = 0;
  sizeHint!: SizeHint;
  disconnected = false;
  // set by TabManager: called when the session socket closes / Enter requests reconnect
  onSocketClosed?: () => void;
  onReconnectRequested?: () => void;
  private disconnectOverlay!: DisconnectOverlay;
  // Floating IME composition box — currently disabled, will be toggleable
  // via a shortcut later. Wiring is kept intact; flip imeBoxEnabled on.
  private imeBox!: ImeBox;
  private imeBoxEnabled = false;
  // Stable-run filter feeding the IME anchor position (anti animation jitter).
  private cursorFilter = new CursorPositionFilter();
  private onRenderDisposable?: IDisposable;
  private attachAddon?: import("@xterm/addon-attach").AttachAddon;

  constructor(id: string, type: TabType, label: string, container: HTMLElement) {
    this.id = id;
    this.type = type;
    this.label = label;

    this.element = document.createElement("div");
    this.element.className = "terminal-instance";
    this.element.style.display = "none";
    container.appendChild(this.element);
    this.sizeHint = new SizeHint(this.element, 1200, configStore.get("fontFamily"));
    this.disconnectOverlay = new DisconnectOverlay(this.element);
    this.imeBox = new ImeBox(this.element, configStore.get("fontFamily"));

    // Enter on a disconnected session triggers reconnect (capture, before xterm)
    this.element.addEventListener("keydown", (e: KeyboardEvent) => {
      if (this.disconnected && e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        this.onReconnectRequested?.();
      }
    }, true);

    this.terminal = new Terminal({
      allowProposedApi: true,
      cursorBlink: true,
      fontSize: configStore.get("fontSize"),
      fontFamily: configStore.get("fontFamily"),
      scrollback: configStore.get("scrollback"),
      theme: findTheme(configStore.get("themeName")).theme,
    });

    this.fitAddon = new FitAddon();
    this.terminal.loadAddon(this.fitAddon);
    this.searchAddon = new SearchAddon();
    this.terminal.loadAddon(this.searchAddon);

    // OSC 9;4 progress reporting (build tasks etc.)
    this.terminal.parser.registerOscHandler(9, (data: string) => {
      const p = parseOsc9Progress(data);
      if (!p) return false;
      this.setProgress(p.state, p.progress);
      return true;
    });
    if (configStore.get("renderer") === "webgl") this.terminal.loadAddon(new WebglAddon());
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
        clipboardWriteText(sel).catch(logCatch("clipboard.write"));
        this.terminal.clearSelection();
      } else {
        clipboardReadText().then(t => {
          if (t) this.terminal.paste(trimPasteContent(t, configStore.get("pasteTrim")));
        }).catch(logCatch("clipboard.read"));
      }
    }, true);

    // Sample cursor position on every render — the dwell filter uses these
    // samples to pick a stable IME anchor even during animated redraws.
    this.onRenderDisposable = this.terminal.onRender(() => {
      const buf = this.terminal.buffer.active;
      this.cursorFilter.sample(buf.cursorX, buf.cursorY);
    });

    // Drive the native IME candidate window with the filtered cursor position.
    this._patchImeFreeze();

    // Floating IME composition box (disabled for now — see imeBoxEnabled).
    const textarea = this.element.querySelector(".xterm-helper-textarea") as HTMLElement | null;
    if (this.imeBoxEnabled && textarea) {
      this.imeBox.attach(textarea, () => this._cursorPixelPos());
    }
  }

  // Filtered cursor position in pixels, relative to the terminal element.
  private _cursorPixelPos(): { x: number; y: number; cellH: number } {
    try {
      const core = (this.terminal as any)._core;
      const dims = core._renderService.dimensions.css.cell;
      const cell = this._imeAnchorCell();
      return {
        x: cell.x * dims.width,
        y: cell.y * dims.height,
        cellH: dims.height,
      };
    } catch {
      return { x: 8, y: 8, cellH: 16 };
    }
  }

  // Anchor cell for the IME candidate window, viewport-relative.
  // Some TUIs (e.g. pi) hide the hardware cursor (\x1b[?25l) and draw their
  // own as an inverse-video cell. In that case buffer.cursorX/Y is wherever
  // the app parked the cursor (often line end), so scan the viewport for the
  // rendered cursor instead. Falls back to the stable-run filter position.
  private _imeAnchorCell(): { x: number; y: number } {
    const buf = this.terminal.buffer.active;
    const fallback = this.cursorFilter.position() ?? { x: buf.cursorX, y: buf.cursorY };
    try {
      const core = (this.terminal as any)._core;
      if (!core.coreService?.isCursorHidden) return fallback;
      let best: { x: number; y: number; d: number } | null = null;
      const ref = buf.cursorY * 10000 + buf.cursorX; // prefer cell nearest the parked cursor
      for (let y = 0; y < this.terminal.rows; y++) {
        const line = buf.getLine(buf.viewportY + y);
        if (!line) continue;
        let cell: IBufferCell | undefined;
        for (let x = 0; x < line.length; x++) {
          cell = line.getCell(x, cell);
          if (!cell) break;
          if (cell.isInverse()) {
            const d = Math.abs(y * 10000 + x - ref);
            if (!best || d < best.d) best = { x, y, d };
          }
        }
      }
      return best ? { x: best.x, y: best.y } : fallback;
    } catch {
      return fallback;
    }
  }

  // Attach (or re-attach) the session WebSocket. Disposes any previous addon.
  // The hub multiplexes all sessions on one port; routing is by path and the
  // per-process token authenticates the handshake.
  attachSocket(port: number, token: string): void {
    this.attachAddon?.dispose();
    this.attachAddon = undefined;
    import("@xterm/addon-attach").then(({ AttachAddon }) => {
      const socket = new WebSocket(`ws://127.0.0.1:${port}/pty/${encodeURIComponent(this.id)}?token=${token}`);
      socket.addEventListener("close", () => this.onSocketClosed?.());
      if (this.type === "serial") {
        // Serial tabs forward input themselves (input modes: normal/echo/line)
        this.attachAddon = new AttachAddon(socket, { bidirectional: false });
        this.serialSocket = socket;
        this._hookSerialInput();
      } else {
        this.attachAddon = new AttachAddon(socket);
      }
      this.terminal.loadAddon(this.attachAddon);
    });
  }

  private serialSocket?: WebSocket;
  private serialInputDisposable?: { dispose(): void };

  private _hookSerialInput(): void {
    this.serialInputDisposable?.dispose();
    const handler = createSerialInputHandler(
      this.inputMode,
      this.enterNewline,
      (d) => {
        const s = this.serialSocket;
        if (s && s.readyState === WebSocket.OPEN) s.send(d);
      },
      (d) => this.terminal.write(d),
    );
    this.serialInputDisposable = this.terminal.onData((d) => handler(d));
  }

  setSerialInputMode(mode: SerialInputMode): void {
    this.inputMode = mode;
    if (this.type === "serial") this._hookSerialInput();
  }

  setSerialEnterNewline(mode: SerialEnterNewline): void {
    this.enterNewline = mode;
    if (this.type === "serial") this._hookSerialInput();
  }

  setDisconnected(v: boolean): void {
    this.disconnected = v;
    if (v) this.disconnectOverlay.show();
    else this.disconnectOverlay.hide();
    this.tabElement?.classList.toggle("disconnected", v);
  }

  // OSC 9;4 progress: update stored state and the tab progress bar.
  setProgress(state: number, progress: number): void {
    this.progressState = state;
    this.progress = progress;
    if (this.tabElement) applyProgressToTabElement(this.tabElement, state, progress);
  }

  private _patchImeFreeze(): void {
    // Replace xterm.js's own IME textarea positioning with a filtered anchor:
    //  - anchor = dwell-filter mode position (robust against animation frames,
    //    where the instantaneous cursor cell at compositionstart is unreliable)
    //  - during composition the textarea style is frozen via a Proxy, and a
    //    200ms timer re-anchors from the filter so the native candidate window
    //    follows once the cursor settles.
    let left: number | null = null;
    let top: number | null = null;
    let refreshTimer: number | null = null;

    const core = (this.terminal as any)._core;

    // Need to wait for xterm.open() to complete before _core.textarea exists.
    // open() runs synchronously in the constructor above, so it's safe here.
    const ta: HTMLTextAreaElement | undefined = core.textarea;
    if (!ta) return;

    // Filtered cursor position in pixels, relative to the terminal element.
    const pxPos = (): { x: number; y: number } | null => {
      const dims = core._renderService?.dimensions?.css;
      if (!dims) return null;
      const cell = this._imeAnchorCell();
      return { x: cell.x * dims.cell.width, y: cell.y * dims.cell.height };
    };

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

    const stopRefresh = () => {
      if (refreshTimer !== null) {
        clearInterval(refreshTimer);
        refreshTimer = null;
      }
    };

    // compositionstart/end: capture the frozen anchor position.
    // These fire on the hidden textarea and bubble through document.
    document.addEventListener("compositionstart", (e) => {
      if (e.target !== ta) return; // only this tab's textarea
      const p = pxPos();
      if (p) {
        left = p.x;
        top = p.y;
      }
      // Periodically re-anchor from the filter while composing. Writes go to
      // origStyle directly, bypassing the freeze Proxy.
      stopRefresh();
      refreshTimer = window.setInterval(() => {
        const q = pxPos();
        if (!q || (q.x === left && q.y === top)) return;
        left = q.x;
        top = q.y;
        origStyle.left = q.x + "px";
        origStyle.top = q.y + "px";
      }, 200);
    }, true);

    document.addEventListener("compositionend", (e) => {
      if (e.target !== ta) return;
      left = null;
      top = null;
      stopRefresh();
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

    if (this.terminal.cols !== cols || this.terminal.rows !== rows) {
      this.terminal.resize(cols, rows);
      this.sizeHint.show(cols, rows);
    }

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
    this.sizeHint.destroy();
    this.disconnectOverlay.destroy();
    this.imeBox.destroy();
    this.onRenderDisposable?.dispose();
    this.element.remove();
    this.tabElement.remove();
    this.terminal.dispose();
  }

  private _showContextMenu(x: number, y: number): void {
    import("./contextmenu").then(m => m.showTerminalContextMenu(this.id, x, y));
  }
}


