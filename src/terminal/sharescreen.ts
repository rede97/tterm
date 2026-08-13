// AI session sharing: screen capture for a terminal.
// Character-level snapshot (the xterm buffer is the ground-truth grid — no
// OCR, no ANSI parsing) and a PNG redraw of the visible screen (xterm's
// WebGL canvas has no preserveDrawingBuffer, so reading it back yields a
// blank image — we redraw onto a 2D canvas instead).

import type { IBufferCell, Terminal } from "@xterm/xterm";
import type { TabType } from "../core/types";
import { cellDimensions } from "../util/xterm-internals";
import { shareLineState } from "./sharelines";

/** Everything the capture needs from a tab — kept as a narrow interface so
 * this module never sees TerminalTab (and stays testable). */
export interface ShareScreenSource {
  id: string;
  label: string;
  type: TabType;
  terminal: Terminal;
  shareSeq: number;
  cursorHidden(): boolean;
  // Where input actually lands when the TUI draws its own fake cursor.
  fakeCursorCell(): { x: number; y: number };
}

export function buildShareSnapshot(t: ShareScreenSource): Record<string, unknown> {
  const buf = t.terminal.buffer.active;
  const lines: string[] = [];
  for (let y = 0; y < t.terminal.rows; y++) {
    lines.push(buf.getLine(buf.viewportY + y)?.translateToString(true) ?? "");
  }
  const cursorHidden = t.cursorHidden();
  const ls = shareLineState(t.terminal);
  const snap: Record<string, unknown> = {
    id: t.id,
    label: t.label,
    type: t.type,
    cols: t.terminal.cols,
    rows: t.terminal.rows,
    cursor: { x: buf.cursorX, y: buf.cursorY, visible: !cursorHidden },
    alt_screen: buf.type === "alternate",
    seq: t.shareSeq,
    // Absolute line addressing (see /lines endpoint): total = one past the
    // newest line; viewport_first = absolute index of the top visible row.
    epoch: ls.epoch,
    total: ls.trimBase + buf.length,
    viewport_first: ls.trimBase + buf.viewportY,
    lines,
  };
  if (cursorHidden) snap.fake_cursor = t.fakeCursorCell();
  return snap;
}

/** Returns { png: base64, cols, rows, seq } or { error }. */
export async function buildShareScreenshot(
  t: ShareScreenSource,
  scale = 2,
): Promise<Record<string, unknown>> {
  try {
    const buf = t.terminal.buffer.active;
    const dims = cellDimensions(t.terminal);
    const cellW = dims?.width ?? 8;
    const cellH = dims?.height ?? 16;
    const cols = t.terminal.cols;
    const rows = t.terminal.rows;
    const theme: Record<string, unknown> = { ...(t.terminal.options.theme ?? {}) };
    // Only string entries are colors (extendedAnsi is a string[]).
    const themeColor = (key: string): string | undefined => {
      const v = theme[key];
      return typeof v === "string" ? v : undefined;
    };
    const fontSize = t.terminal.options.fontSize ?? 14;
    const fontFamily = t.terminal.options.fontFamily ?? "monospace";
    scale = Math.min(4, Math.max(1, Math.floor(scale) || 2));

    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(cols * cellW * scale);
    canvas.height = Math.ceil(rows * cellH * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return { error: "no 2d canvas context" };
    ctx.scale(scale, scale);

    const DEFAULT16 = [
      "#000000",
      "#cd3131",
      "#00bc00",
      "#949800",
      "#0451a5",
      "#bc05bc",
      "#0598bc",
      "#555555",
      "#666666",
      "#f14c4c",
      "#23d18b",
      "#f5f543",
      "#3b8eea",
      "#d670d6",
      "#29b8db",
      "#e5e5e5",
    ];
    const THEME16 = [
      "black",
      "red",
      "green",
      "yellow",
      "blue",
      "magenta",
      "cyan",
      "white",
      "brightBlack",
      "brightRed",
      "brightGreen",
      "brightYellow",
      "brightBlue",
      "brightMagenta",
      "brightCyan",
      "brightWhite",
    ];
    const CUBE = [0, 95, 135, 175, 215, 255];
    const palette = (i: number): string => {
      if (i < 16) return themeColor(THEME16[i]) ?? DEFAULT16[i];
      if (i < 232) {
        const n = i - 16;
        return `rgb(${CUBE[Math.floor(n / 36)]},${CUBE[Math.floor((n % 36) / 6)]},${CUBE[n % 6]})`;
      }
      const g = 8 + (i - 232) * 10;
      return `rgb(${g},${g},${g})`;
    };

    const defaultFg = themeColor("foreground") ?? "#cccccc";
    const defaultBg = themeColor("background") ?? "#1e1e1e";
    const resolve = (mode: number, color: number, isFg: boolean): string => {
      if (mode === 2) return `#${(color & 0xffffff).toString(16).padStart(6, "0")}`;
      if (mode === 1) return palette(color & 0xff);
      return isFg ? defaultFg : defaultBg;
    };

    ctx.fillStyle = defaultBg;
    ctx.fillRect(0, 0, cols * cellW, rows * cellH);
    ctx.textBaseline = "middle";

    for (let y = 0; y < rows; y++) {
      const line = buf.getLine(buf.viewportY + y);
      if (!line) continue;
      let cell: IBufferCell | undefined;
      for (let x = 0; x < line.length; x++) {
        cell = line.getCell(x, cell);
        if (!cell) break;
        const w = cell.getWidth();
        if (w === 0) continue; // second half of a wide char
        let fg = resolve(cell.getFgColorMode(), cell.getFgColor(), true);
        let bg = resolve(cell.getBgColorMode(), cell.getBgColor(), false);
        if (cell.isInverse()) [fg, bg] = [bg, fg];
        if (bg !== defaultBg) {
          ctx.fillStyle = bg;
          ctx.fillRect(x * cellW, y * cellH, cellW * w, cellH);
        }
        const chars = cell.getChars();
        if (chars && chars !== " ") {
          ctx.font = `${cell.isItalic() ? "italic " : ""}${cell.isBold() ? "bold " : ""}${fontSize}px ${fontFamily}`;
          ctx.fillStyle = fg;
          ctx.globalAlpha = cell.isDim() ? 0.6 : 1;
          ctx.fillText(chars, x * cellW, y * cellH + cellH / 2);
          ctx.globalAlpha = 1;
          if (cell.isUnderline()) ctx.fillRect(x * cellW, y * cellH + cellH - 2, cellW * w, 1);
          if (cell.isStrikethrough()) ctx.fillRect(x * cellW, y * cellH + cellH / 2, cellW * w, 1);
        }
      }
    }

    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
    if (!blob) return { error: "png encode failed" };
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return { png: btoa(bin), cols, rows, seq: t.shareSeq };
  } catch (e) {
    return { error: String(e) };
  }
}
