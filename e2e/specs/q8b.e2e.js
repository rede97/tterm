// Q8b acceptance: panel overflow must NOT shift the 148px control column
// (floating overlay thumb instead of a classic gutter).
describe("q8b overlay scrollbar", () => {
  it("control column stays put when the panel overflows", async () => {
    await browser.waitUntil(async () => browser.execute(() => !!window.__tterm), {
      timeout: 15000,
    });
    await browser.waitUntil(async () => browser.execute(() => window.__tterm.mgr.tabs.size >= 1), {
      timeout: 15000,
    });
    await browser.pause(500);
    const created = await browser.executeAsync((done) => {
      (async () => {
        const tab = await window.__tterm.mgr.createSerialTab({
          name: "MOCK-LOOP",
          driver: "tterm-mock",
          manufacturer: "TTerm",
          product: "Mock Loopback (echo)",
          vid: "",
          pid: "",
        });
        done(!!tab);
      })();
    });
    expect(created).toBe(true);
    await browser.waitUntil(
      async () =>
        browser.execute(
          () => window.__tterm.mgr.get(window.__tterm.mgr.activeTabId)?.type === "serial",
        ),
      { timeout: 8000 },
    );
    await browser.execute(() => document.getElementById("quick-status").click());
    await browser.waitUntil(
      async () =>
        browser.execute(
          () => !!document.querySelector('.quick-panel.open [data-section="serial"]'),
        ),
      { timeout: 8000 },
    );

    const flowRight = () =>
      browser.execute(() =>
        document
          .querySelector('.qp-select[aria-label="Flow control"] .qp-select-trigger')
          .getBoundingClientRect()
          .right.toFixed(1),
      );

    // Fits: no overflow.
    const before = await flowRight();
    expect(await browser.execute(() => !!document.querySelector(".quick-panel .ov-sb.on"))).toBe(
      false,
    );

    // Shrink the window: content overflows → thumb appears, no classic gutter.
    const size = await browser.getWindowSize();
    await browser.setWindowSize(size.width, 560);
    await browser.pause(500);
    const overflowState = await browser.execute(() => {
      const p = document.querySelector(".quick-panel");
      return {
        scrolls: p.scrollHeight > p.clientHeight + 1,
        thumbOn: !!p.querySelector(".ov-sb.on"),
        // Gutter check: border 1px×2 is normal; a classic bar adds ~8px more.
        classicBar: p.offsetWidth - p.clientWidth > 2,
      };
    });
    console.log("Q8B", JSON.stringify(overflowState));
    expect(overflowState.scrolls).toBe(true);
    expect(overflowState.thumbOn).toBe(true);
    expect(overflowState.classicBar).toBe(false);

    const after = await flowRight();
    expect(after).toBe(before); // the 148px column did not shift

    // Scroll to the bottom: thumb tracks, still no gutter.
    await browser.execute(() => {
      const p = document.querySelector(".quick-panel");
      p.scrollTop = p.scrollHeight;
      p.dispatchEvent(new Event("scroll"));
    });
    await browser.pause(200);
    expect(await flowRight()).toBe(before);
    await browser.saveScreenshot("shots7/q8b-overflow.png");

    await browser.setWindowSize(size.width, size.height);
  });
});
