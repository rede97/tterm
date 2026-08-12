// Regression test for issue rede97/tterm#1 (omp TUI freezes the tab).
//
// Root cause: the production bundle (esbuild minify, es2020 target) mis-lowered
// a logical assignment in xterm.js's DECRQM handler (`CSI ? Pm $ p`),
// producing an uncaught ReferenceError that permanently killed xterm's
// write/parse loop. Dev-mode builds were unaffected (no minify), which is why
// it only shipped in releases. Any app sending a private-mode query (omp,
// modern TUIs probing sync-output mode 2026, etc.) froze the tab on the very
// first bytes; pi never queried and worked fine.
//
// This spec replays the exact 93,723-byte stream from the issue through the
// REAL data path — synthetic `message` events on the tab's live WebSocket, so
// BatchAttachAddon batching, the parser, replies and the renderer all run —
// and asserts the pipeline stays alive afterwards.
//
// On the debug build (default `bun run test:e2e`) this guards the transport
// and parser contract. To guard the minified-bundle regression itself, run it
// against the release variant: `bun run test:e2e:release` (prereqs in
// e2e/wdio.release.conf.js).
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const streamB64 = readFileSync(
  path.resolve(__dirname, "../../tests/fixtures/omp-startup-stream.bin"),
).toString("base64");

const probe = () =>
  browser.execute(() => {
    const mgr = window.__tterm.mgr;
    const tab = mgr.get(mgr.activeTabId);
    const buf = tab.terminal.buffer.active;
    let text = "";
    for (let y = 0; y < tab.terminal.rows; y++) {
      text += `${buf.getLine(buf.viewportY + y)?.translateToString(true) ?? ""}\n`;
    }
    return {
      shareSeq: tab.shareSeq,
      renders: window.__reproRenders,
      errors: window.__reproErrors,
      text,
    };
  });

describe("omp byte-stream replay via WS path (issue #1)", () => {
  it("keeps parsing and rendering after the 93KB stream", async () => {
    await browser.waitUntil(async () => (await $$("#tabs .tab")).length >= 1, { timeout: 15000 });

    // Render counter + page error capture (the original failure was an
    // uncaught ReferenceError inside the parser's scheduled write loop).
    await browser.execute(() => {
      window.__reproErrors = [];
      window.addEventListener("error", (e) =>
        window.__reproErrors.push(String(e.error?.stack ?? e.message)),
      );
      window.addEventListener("unhandledrejection", (e) =>
        window.__reproErrors.push(`rejection: ${String(e.reason?.stack ?? e.reason)}`),
      );
      const mgr = window.__tterm.mgr;
      const tab = mgr.get(mgr.activeTabId);
      window.__reproRenders = 0;
      tab.terminal.onRender(() => window.__reproRenders++);
    });

    // Replay the full stream as SSH-like 32KB channel chunks delivered as WS
    // messages — BatchAttachAddon coalesces them exactly like session output.
    const delivered = await browser.executeAsync((b64, done) => {
      const mgr = window.__tterm.mgr;
      const tab = mgr.get(mgr.activeTabId);
      const addon = tab.attachAddon;
      const ws = addon && Object.values(addon).find((v) => v instanceof WebSocket);
      if (!ws) {
        done("NO-SOCKET");
        return;
      }
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const CHUNK = 32 * 1024;
      let off = 0;
      (function pump() {
        if (off >= bytes.length) {
          done(bytes.length);
          return;
        }
        const slice = bytes.slice(off, off + CHUNK);
        ws.dispatchEvent(new MessageEvent("message", { data: slice.buffer }));
        off += CHUNK;
        setTimeout(pump, 8);
      })();
    }, streamB64);
    expect(delivered).toBe(93723);

    // The frozen tab accepted no further output: a marker written after the
    // replay must render and land in the buffer.
    await browser.pause(1500);
    const before = await probe();
    await browser.execute(() => {
      const mgr = window.__tterm.mgr;
      mgr.get(mgr.activeTabId).terminal.write("\r\n=== REPLAY MARKER ===\r\n");
    });
    await browser.pause(800);
    const after = await probe();

    expect(after.errors).toEqual([]);
    expect(after.renders).toBeGreaterThan(before.renders);
    expect(after.shareSeq).toBeGreaterThan(before.shareSeq);
    expect(after.text).toContain("=== REPLAY MARKER ===");
  });
});
