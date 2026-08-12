// Batched WS → xterm bridge (AttachAddon replacement).
//
// Why: ConPTY emits a full-screen animation frame as TWO pipe writes — a bare
// ESC[2J (erase display) followed ~1-3ms later by the frame content. Feeding
// each WS message straight into terminal.write() lets xterm present the erase
// as a fully blank frame before the content parses (visible flicker, worse at
// large terminal sizes). Coalescing messages within a small time window makes
// erase+content land in a single parse → single render → no blank frame.
//
// Cost: up to FLUSH_MS added latency on output. FLUSH_MS is far below the
// perceptible threshold for keystroke echo (>10ms), and a byte threshold
// keeps sustained floods flushing promptly.

import type { Terminal } from "@xterm/xterm";

const FLUSH_MS = 6;
const IMMEDIATE_FLUSH_BYTES = 128 * 1024;

interface Disposable {
  dispose(): void;
}

function listen<K extends keyof WebSocketEventMap>(
  target: WebSocket,
  type: K,
  fn: (ev: WebSocketEventMap[K]) => void,
): Disposable {
  target.addEventListener(type, fn);
  return { dispose: () => target.removeEventListener(type, fn) };
}

export class BatchAttachAddon {
  private disposables: Disposable[] = [];
  private queue: Uint8Array[] = [];
  private queuedBytes = 0;
  private timer: number | null = null;
  private encoder = new TextEncoder();

  constructor(
    private socket: WebSocket,
    private terminal: Terminal,
    options?: { bidirectional?: boolean },
  ) {
    socket.binaryType = "arraybuffer";
    this.disposables.push(listen(socket, "message", (ev) => this._onMessage(ev)));
    this.disposables.push(listen(socket, "close", () => this.dispose()));
    this.disposables.push(listen(socket, "error", () => this.dispose()));
    if (options?.bidirectional !== false) {
      this.disposables.push(terminal.onData((d) => this._sendText(d)));
      this.disposables.push(terminal.onBinary((d) => this._sendBinary(d)));
    }
  }

  private _onMessage(ev: MessageEvent): void {
    const d = ev.data;
    const bytes = typeof d === "string" ? this.encoder.encode(d) : new Uint8Array(d as ArrayBuffer);
    this.queue.push(bytes);
    this.queuedBytes += bytes.length;
    if (this.queuedBytes >= IMMEDIATE_FLUSH_BYTES) {
      this._flush();
    } else if (this.timer === null) {
      this.timer = window.setTimeout(() => this._flush(), FLUSH_MS);
    }
  }

  private _flush(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.queue.length === 0) return;
    let merged: Uint8Array;
    if (this.queue.length === 1) {
      merged = this.queue[0];
    } else {
      merged = new Uint8Array(this.queuedBytes);
      let off = 0;
      for (const chunk of this.queue) {
        merged.set(chunk, off);
        off += chunk.length;
      }
    }
    this.queue = [];
    this.queuedBytes = 0;
    this.terminal.write(merged);
  }

  private _sendText(data: string): void {
    if (this.socket.readyState === WebSocket.OPEN) this.socket.send(data);
  }

  private _sendBinary(data: string): void {
    if (this.socket.readyState !== WebSocket.OPEN) return;
    const bytes = new Uint8Array(data.length);
    for (let i = 0; i < data.length; i++) bytes[i] = data.charCodeAt(i) & 255;
    this.socket.send(bytes);
  }

  dispose(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.queue = [];
    this.queuedBytes = 0;
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
  }
}
