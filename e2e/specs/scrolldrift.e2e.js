// Horizontal scroll drift protection (htop/btop IME bug).
//
// Chromium's implicit scroll-into-view on the IME textarea/caret can set
// scrollLeft on any scrollable ancestor of the terminal, shifting content
// left and clipping the leftmost column. overflow-x: clip removes the
// scrolling mechanism entirely — which is objectively testable: assigning
// scrollLeft must be a no-op on every candidate container.

describe("horizontal scroll drift protection", () => {
  it("rejects programmatic horizontal scrolling on all terminal containers", async () => {
    await browser.waitUntil(async () => (await $$(".terminal-instance .xterm-viewport")).length > 0, { timeout: 15000 });
    const result = await browser.execute(() => {
      const inst = document.querySelector(".terminal-instance");
      const viewport = inst.querySelector(".xterm-viewport");
      const scrollable = inst.querySelector(".xterm-scrollable-element");
      const container = document.getElementById("terminal-container");
      const probe = (el) => {
        el.scrollLeft = 25;
        return el.scrollLeft;
      };
      return {
        instance: probe(inst),
        viewport: probe(viewport),
        scrollable: probe(scrollable),
        container: probe(container),
        body: probe(document.body),
        documentElement: probe(document.documentElement),
      };
    });
    expect(result.instance).toBe(0);
    expect(result.viewport).toBe(0);
    expect(result.scrollable).toBe(0);
    expect(result.container).toBe(0);
    expect(result.body).toBe(0);
    expect(result.documentElement).toBe(0);
  });

  it("keeps vertical scrolling intact (overflow-y unaffected)", async () => {
    const overflowY = await browser.execute(() => {
      return getComputedStyle(document.querySelector(".terminal-instance .xterm-viewport")).overflowY;
    });
    expect(overflowY).toBe("scroll");
  });
});
