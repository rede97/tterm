// WebGL backing-store misallocation (WebView2 mixed-DPI bug, runtime
// 150.0.4078.105+) — guard verification.
//
// Background: on mixed-DPI setups the WebGL drawing buffer can be sized for
// the wrong devicePixelRatio (e.g. a window created on a 150% monitor then
// moved to a 100% one keeps a 1.5x backing). xterm trusts the buffer size
// for device metrics, so the rendered grid shifts ~half a cell and the
// leftmost glyphs get clipped. IME composition is a common trigger because
// it makes xterm recreate the canvas.
//
// The guard (tab.ts _webglGuard) detects the mismatch and falls back to the
// DOM renderer one-way. This spec asserts the INVARIANT, whichever side of
// the bug the current machine is on:
//   - renderer healthy  -> WebGL addon alive AND backing ratio ≈ DPR
//   - bug observed      -> addon disposed AND fallback reason recorded

describe("WebGL backing-store misallocation guard", () => {
  it("keeps the renderer consistent: either healthy WebGL or recorded DOM fallback", async () => {
    await browser.waitUntil(async () => (await $$(".terminal-instance")).length > 0, { timeout: 15000 });

    const state = await browser.execute(() => {
      const inst = [...document.querySelectorAll(".terminal-instance")].find((e) => e.style.display !== "none");
      const tab = [...window.__tterm.tabs.values()].find((t) => t.element === inst);
      if (!tab) return null;
      tab.fitDeferred(); // ensure the guard's startup check ran
      return new Promise((resolve) =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            const canvas = inst.querySelector(".xterm-screen canvas:not(.xterm-link-layer)");
            let ratio = null;
            if (canvas && canvas.clientWidth > 0) {
              const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
              if (gl) ratio = gl.drawingBufferWidth / canvas.clientWidth;
            }
            resolve({
              addonAlive: !!tab.webglAddon,
              fallbackReason: tab.webglFallbackReason ?? null,
              ratio,
              dpr: devicePixelRatio,
            });
          })
        )
      );
    });

    expect(state).not.toBeNull();
    console.log(
      `[webgl-guard] addonAlive=${state.addonAlive} ratio=${state.ratio?.toFixed(3)} dpr=${state.dpr.toFixed(3)} fallback=${state.fallbackReason}`
    );

    if (state.addonAlive) {
      // WebGL stayed on: its buffer scale must actually match the DPR,
      // otherwise the guard should have fired (invariant violation).
      expect(state.ratio).not.toBeNull();
      expect(Math.abs(state.ratio - state.dpr) / state.dpr).toBeLessThanOrEqual(0.05);
    } else {
      // Fell back: the guard must have recorded why.
      expect(state.fallbackReason).not.toBeNull();
    }
  });
});
