import { invoke } from "@tauri-apps/api/core";
import {
  readText as clipboardReadText,
  writeText as clipboardWriteText,
} from "@tauri-apps/plugin-clipboard-manager";
import type { FitAddon } from "@xterm/addon-fit";
import type { SearchAddon } from "@xterm/addon-search";
import type { IDisposable, Terminal } from "@xterm/xterm";
import { logCatch, swallow } from "../core/errorlog";
import { configStore } from "../core/store";
import { notifyTrayTabs } from "../core/traytabs";
import type {
  SerialEnterNewline,
  SerialInputMode,
  SerialPort,
  SshHost,
  TabType,
} from "../core/types";
import { reattachDelayForAttempt, shouldAutoReattach } from "../util/disconnect";
import { cursorPixelPos, imeAnchorCell } from "../util/imeanchor";
import { getImeDebugFlags, ImeBox, imeMirrorActiveFor } from "../util/imebox";
import { CursorPositionFilter } from "../util/imefilter";
import { type FreezeHandle, patchImeFreeze } from "../util/imefreeze";
import { applyProgressToTabElement, parseOsc9Progress } from "../util/osc";
import { createSerialInputHandler } from "../util/serialinput";
import { SizeHint } from "../util/sizehint";
import { cursorIsHidden } from "../util/xterm-internals";
import { BatchAttachAddon } from "./batchattach";
import { computeGrid } from "./fit";
import { pasteIntoTerminal } from "./paste";
import { recordShareSeq } from "./sharelines";
import { buildShareScreenshot, buildShareSnapshot } from "./sharescreen";
import { TitleModel } from "./title";
import { createXterm } from "./xtermfactory";

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
  // True when this SSH tab runs on the built-in client (port forwarding
  // available); false/undefined for the spawned-ssh-binary path.
  sshEmbedded = false;
  serialPortName?: string;
  // Full port descriptor for "Duplicate Tab" (name alone can't respawn).
  serialPort?: SerialPort;
  // Active serial profile name + its live-adjustable fields.
  serialProfile?: string;
  flowControl?: string;
  serialBaud?: number;
  /** Link frame at open (8N1 / 8E1 / 8O1) — for QP meta, not live-editable yet. */
  serialFrame?: string;
  outputNewline?: string;
  inputMode: SerialInputMode = "normal";
  enterNewline: SerialEnterNewline = "cr";
  // Title state lives in TitleModel; label/titleLocked are accessors so the
  // public read surface (tab.label, tab.titleLocked) is unchanged.
  private _title: TitleModel;
  get label(): string {
    return this._title.label;
  }
  get titleLocked(): boolean {
    return this._title.locked;
  }
  color?: string;
  needsResize = false;
  index = 0;
  searchQuery = "";
  progressState = 0;
  progress = 0;
  sizeHint!: SizeHint;
  disconnected = false;
  // AI session sharing: set by TabManager.shareTab. While shared, renders
  // bump shareSeq (throttled) to the backend so long-poll clients wake.
  shared = false;
  shareUrl?: string;
  shareSeq = 0;
  private lastShareSeqSent = 0;
  // set by TabManager: called when the session socket closes for good
  onSocketClosed?: () => void;
  // Floating IME composition mirror (Plan C). Shows the composition string
  // near the anchor when xterm's native composition-view is unreliable
  // (cursor-hiding TUIs) — or everywhere in "always" test mode.
  private imeBox!: ImeBox;
  // Stable-run filter feeding the IME anchor position (anti animation jitter).
  private cursorFilter = new CursorPositionFilter();
  private onRenderDisposable?: IDisposable;
  private attachAddon?: BatchAttachAddon;
  // When true, BatchAttachAddon ignores keystrokes (SSH secret collect).
  private inputMuted = false;
  // IME freeze proxy handle (see util/imefreeze.ts) — disposed on destroy.
  private _imeFreeze?: FreezeHandle;

  constructor(id: string, type: TabType, label: string, container: HTMLElement) {
    this.id = id;
    this.type = type;
    this._title = new TitleModel(label);

    this.element = document.createElement("div");
    this.element.className = "terminal-instance";
    this.element.style.display = "none";
    container.appendChild(this.element);
    this.sizeHint = new SizeHint(this.element, 1200, configStore.get("fontFamily"));
    this.imeBox = new ImeBox(this.element, configStore.get("fontFamily"));

    const instance = createXterm(this.element, {
      fontSize: configStore.get("fontSize"),
      fontFamily: configStore.get("fontFamily"),
      scrollback: configStore.get("scrollback"),
      themeName: configStore.get("themeName"),
      renderer: configStore.get("renderer"),
    });
    this.terminal = instance.terminal;
    this.fitAddon = instance.fitAddon;
    this.searchAddon = instance.searchAddon;

    // OSC 9;4 progress reporting (build tasks etc.)
    this.terminal.parser.registerOscHandler(9, (data: string) => {
      const p = parseOsc9Progress(data);
      if (!p) return false;
      this.setProgress(p.state, p.progress);
      return true;
    });

    // Single source of truth for backend size tracking: ANY grid change
    // (fit, font-metric re-measure refits, window resize) fires onResize.
    // fitDeferred's explicit invoke alone misses font-race refits, which left
    // size-dependent sessions (Anime TTY) rendering for a stale grid.
    this.terminal.onResize(({ cols, rows }) => {
      invoke("pty_resize", { id: this.id, cols, rows }).catch(swallow);
    });

    this.terminal.onTitleChange((title: string) => {
      if (this._title.onOscTitle(title)) this._syncTitleDom();
    });

    this.xtermEl = this.element.querySelector(".xterm") as HTMLElement;

    // Prevent horizontal scroll drift: xterm.js sets scrollLeft on the
    // viewport when a line briefly exceeds the visible width (common during
    // TUI redraws). CSS overflow-x:hidden hides the scrollbar but does NOT
    // block programmatic scrollLeft in Chromium, so a race can leave
    // scrollLeft > 0 after the redraw completes — clipping the leftmost
    // column. Clamp it back to 0 on every scroll event.
    const viewport = this.element.querySelector(".xterm-viewport") as HTMLElement | null;
    const xtermEl = this.element.querySelector(".xterm") as HTMLElement | null;
    for (const el of [viewport, xtermEl]) {
      el?.addEventListener(
        "scroll",
        () => {
          if (el.scrollLeft !== 0) el.scrollLeft = 0;
        },
        { passive: true },
      );
    }

    // right-click: copy/paste normally, shift+right-click for context menu
    // use capture phase so this fires before xterm.js internal handler
    this.element.addEventListener(
      "contextmenu",
      (e: MouseEvent) => {
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
          clipboardReadText()
            .then((t) => {
              if (t) pasteIntoTerminal(this.terminal, t);
            })
            .catch(logCatch("clipboard.read"));
        }
      },
      true,
    );

    // Sample cursor position on every render — the dwell filter uses these
    // samples to pick a stable IME anchor even during animated redraws.
    this.onRenderDisposable = this.terminal.onRender(() => {
      const buf = this.terminal.buffer.active;
      this.cursorFilter.sample(buf.cursorX, buf.cursorY);
      this.refreshImeClasses();
      this.shareSeq++;
      recordShareSeq(this.terminal, this.shareSeq);
      if (this.shared) {
        const now = Date.now();
        if (now - this.lastShareSeqSent > 200) {
          this.lastShareSeqSent = now;
          invoke("share_screen_changed", { id: this.id, seq: this.shareSeq }).catch(swallow);
        }
      }
    });
    this.refreshImeClasses();

    // Drive the native IME candidate window with the filtered cursor position.
    this._imeFreeze = patchImeFreeze(this.terminal, this.element, this.cursorFilter);

    // Floating IME composition mirror (Plan C): pure display, never touches
    // the input path. shouldMirror gates activation per composition so a
    // cursor-state change mid-session takes effect immediately.
    const textarea = this.element.querySelector(".xterm-helper-textarea") as HTMLElement | null;
    if (textarea) {
      this.imeBox.attach(
        textarea,
        () => cursorPixelPos(this.terminal, this.cursorFilter),
        () => imeMirrorActiveFor(this._isCursorHidden()),
      );
    }

    // Serial input handler: registered once; it resolves `this.serialSocket`
    // at send time, so socket re-attaches need no re-hooking.
    if (this.type === "serial") this._hookSerialInput();
  }

  private _isCursorHidden(): boolean {
    return cursorIsHidden(this.terminal);
  }

  // Reflect IME-mirror state on the instance element:
  //  - `cursor-hidden`: the TUI hid the hardware cursor (diagnostics/tests)
  //  - `ime-mirror-on`: the mirror owns composition display → CSS suppresses
  //    xterm's native composition-view to avoid double rendering
  //    (the suppress debug flag can lift suppression while the mirror stays
  //    on — double display, used for real-IME bisection)
  // Called on every render and on mirror-mode changes.
  refreshImeClasses(): void {
    const hidden = this._isCursorHidden();
    this.element.classList.toggle("cursor-hidden", hidden);
    // Display ownership is locked while a composition is in flight: Agent
    // TUIs flicker the hardware cursor around input fields, and flipping
    // the suppression class mid-composition makes the visible path
    // (mirror vs xterm composition-view) change under the user — the
    // intermittent "native IME box / mirror vanished" symptom. Ownership
    // decided at compositionstart stands until compositionend.
    if (this.imeBox.isComposing) return;
    const active = imeMirrorActiveFor(hidden) && getImeDebugFlags().suppress;
    this.element.classList.toggle("ime-mirror-on", active);
  }

  // Attach (or re-attach) the session WebSocket. Disposes any previous addon.
  // The hub multiplexes all sessions on one port; routing is by path and the
  // per-process token authenticates the handshake.
  //
  // Two close paths, handled differently:
  //  - CLEAN close (server sent a Close frame): the relay slot was torn
  //    down for good (tab kill) → onSocketClosed. Session death alone never
  //    closes the socket — the backend prints an in-band prompt and
  //    respawns on Enter (deadmode.rs).
  //  - ABNORMAL close (1006, e.g. OS sleep/wake resetting loopback TCP):
  //    transport-level only, the backend session is likely alive → silently
  //    re-attach with backoff; the relay buffers session output while
  //    detached, so the terminal resumes with no visible interruption.
  attachSocket(port: number, token: string): void {
    this.socketPort = port;
    this.socketToken = token;
    this.reattachAttempt = 0;
    this._clearReattachTimer();
    this._openSocket();
  }

  private socketPort?: number;
  private socketToken?: string;
  private reattachAttempt = 0;
  private reattachTimer: number | null = null;
  // Monotonic token: stale async continuations (dynamic import, retry
  // timers, events from superseded sockets) check it and bail out.
  private socketGen = 0;

  private _clearReattachTimer(): void {
    if (this.reattachTimer !== null) {
      clearTimeout(this.reattachTimer);
      this.reattachTimer = null;
    }
  }

  private async _openSocket(): Promise<void> {
    const gen = ++this.socketGen;
    const socket = new WebSocket(
      `ws://127.0.0.1:${this.socketPort}/pty/${encodeURIComponent(this.id)}?token=${this.socketToken}`,
    );
    this.socket = socket;

    socket.addEventListener("open", () => {
      if (gen !== this.socketGen) {
        socket.close();
        return;
      }
      this.reattachAttempt = 0;
      this.attachAddon?.dispose();
      this.attachAddon = undefined;
      if (this.type === "serial") {
        // Serial tabs forward input themselves (input modes: normal/echo/line)
        this.serialSocket = socket;
        this.attachAddon = new BatchAttachAddon(socket, this.terminal, { bidirectional: false });
      } else {
        this.attachAddon = new BatchAttachAddon(socket, this.terminal, {
          shouldSend: () => !this.inputMuted,
        });
      }
    });

    socket.addEventListener("close", (e) => {
      if (gen !== this.socketGen) return; // stale socket, already replaced
      if (!shouldAutoReattach(e.wasClean)) {
        this.onSocketClosed?.();
        return;
      }
      const delay = reattachDelayForAttempt(this.reattachAttempt++);
      if (delay === null) {
        // Re-attach kept failing (session really gone): fall back to the
        // disconnected banner + manual reconnect.
        this.onSocketClosed?.();
        return;
      }
      this.reattachTimer = window.setTimeout(() => {
        this.reattachTimer = null;
        if (gen === this.socketGen) this._openSocket();
      }, delay);
    });
  }

  private serialSocket?: WebSocket;
  private serialInputDisposable?: { dispose(): void };
  // The currently attached session socket (serialSocket mirrors it for
  // serial input). Tracked so destroy() can close it — an unclosed socket
  // keeps the relay slot and its event listeners alive.
  private socket?: WebSocket;

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

  muteInput(muted: boolean): void {
    this.inputMuted = muted;
  }

  // Mark the session dead/alive (driven by the backend "session-state"
  // event): the tab label gets a strikethrough while dead.
  setDisconnected(v: boolean): void {
    this.disconnected = v;
    this.tabElement?.classList.toggle("disconnected", v);
  }

  // OSC 9;4 progress: update stored state and the tab progress bar.
  setProgress(state: number, progress: number): void {
    this.progressState = state;
    this.progress = progress;
    if (this.tabElement) applyProgressToTabElement(this.tabElement, state, progress);
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
    const grid = computeGrid(this.terminal, this.element);
    if (!grid) return { cols: this.terminal.cols, rows: this.terminal.rows };
    const { cols, rows } = grid;
    if (this.terminal.cols !== cols || this.terminal.rows !== rows) {
      this.terminal.resize(cols, rows);
      // Reset any horizontal scroll drift that may have accumulated
      // before the resize — the new grid dimensions invalidate the old
      // scroll offset and leaving it non-zero would clip column 0.
      const vp = this.xtermEl.querySelector(".xterm-viewport") as HTMLElement | null;
      if (vp && vp.scrollLeft !== 0) vp.scrollLeft = 0;
      this.sizeHint.show(cols, rows);
    }
    return { cols, rows };
  }

  fitDeferred(): void {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        // The tab may have been closed within these two frames — fit()
        // on a disposed terminal throws (render service is gone).
        if (this._destroyed) return;
        if (this.element.style.display === "none") return;
        // fit() resizes the grid; the onResize handler above ships the new
        // size to the backend (manual invokes here would double-fire).
        this.fit();
        this.needsResize = false;
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

  rename(newName: string, lockTitle = true): void {
    this._title.rename(newName, lockTitle);
    this.command = undefined;
    this._syncTitleDom();
  }

  // Undo a user rename (rename dialog committed empty): follow OSC title
  // changes again, restoring the last title the terminal reported.
  resetTitle(): void {
    this._title.reset();
    this._syncTitleDom(false);
  }

  // Reflect the current label into the tab element + tray. resetTitle passes
  // notifyTray=false to preserve the original (rename-only) tray notification.
  private _syncTitleDom(notifyTray = true): void {
    const labelEl = this.tabElement.querySelector(".tab-label") as HTMLElement;
    if (labelEl) labelEl.textContent = this.label;
    this.tabElement.title = this.label;
    // The close button's accessible name carries the same dynamic label.
    this.tabElement.querySelector(".tab-close")?.setAttribute("aria-label", `Close ${this.label}`);
    if (notifyTray) notifyTrayTabs();
  }

  // ShareScreenSource adapters (sharescreen.ts never sees TerminalTab).
  cursorHidden(): boolean {
    return this._isCursorHidden();
  }

  fakeCursorCell(): { x: number; y: number } {
    return imeAnchorCell(this.terminal, this.cursorFilter);
  }

  // Character-level screen snapshot for AI session sharing (the xterm
  // buffer is the ground-truth grid — no OCR, no ANSI parsing needed).
  buildShareSnapshot(): Record<string, unknown> {
    return buildShareSnapshot(this);
  }

  // PNG screenshot of the visible screen for AI session sharing.
  // Returns { png: base64, cols, rows, seq } or { error }.
  buildShareScreenshot(scale = 2): Promise<Record<string, unknown>> {
    return buildShareScreenshot(this, scale);
  }

  // Set by destroy(); pending async work (fitDeferred's double-rAF)
  // checks it before touching the disposed terminal.
  private _destroyed = false;

  destroy(): void {
    this._destroyed = true;
    // Stop pending re-attach retries and stale socket callbacks.
    this.socketGen++;
    this._clearReattachTimer();
    // Tear down the transport: dispose the attach addon (detaches its
    // socket listeners) and close the socket itself — otherwise the relay
    // slot and a live WebSocket outlive the tab. The close event handler
    // sees the bumped socketGen and bails, so no onSocketClosed fires.
    this.attachAddon?.dispose();
    this.attachAddon = undefined;
    this.serialInputDisposable?.dispose();
    this.serialSocket = undefined;
    this.socket?.close();
    this.socket = undefined;
    this._imeFreeze?.dispose();
    this.sizeHint.destroy();
    this.imeBox.destroy();
    this.onRenderDisposable?.dispose();
    this.element.remove();
    this.tabElement.remove();
    this.terminal.dispose();
  }

  private _showContextMenu(x: number, y: number): void {
    import("./contextmenu").then((m) => m.showTerminalContextMenu(this.id, x, y));
  }
}
