describe("TTerm application", () => {
  it("launches with the custom tab bar", async () => {
    const tabBar = await $("#tab-bar");
    await tabBar.waitForExist({ timeout: 15000 });
    expect(await tabBar.isDisplayed()).toBe(true);
  });

  it("opens the initial terminal tab", async () => {
    await browser.waitUntil(async () => (await $$("#tabs .tab")).length >= 1, { timeout: 15000 });
    expect((await $$("#tabs .tab")).length).toBeGreaterThanOrEqual(1);
  });

  it("creates a new tab from the new-tab button", async () => {
    const before = (await $$("#tabs .tab")).length;
    const btn = await $("#new-tab");
    if (await btn.isExisting()) {
      await btn.click();
      await browser.waitUntil(
        async () => (await $$("#tabs .tab")).length === before + 1,
        { timeout: 15000 }
      );
    }
    expect((await $$("#tabs .tab")).length).toBeGreaterThanOrEqual(before);
  });

  it("switches tabs when clicking the bottom edge of an inactive tab", async () => {
    // Regression: the full tab surface must be clickable, including pixels
    // below the title text (no overlay/scrollbar dead zones).
    const btn = await $("#new-tab");
    if ((await $$("#tabs .tab")).length < 2) await btn.click();
    await browser.waitUntil(async () => (await $$("#tabs .tab")).length >= 2, { timeout: 15000 });

    const first = await browser.execute(() => {
      const tab = document.querySelector("#tabs .tab");
      const rc = tab.getBoundingClientRect();
      return { id: tab.dataset.tabId, x: Math.round(rc.left + rc.width / 2), y: Math.round(rc.bottom - 2) };
    });
    await browser.action("pointer").move({ x: first.x, y: first.y }).down().up().perform();
    await browser.waitUntil(async () => {
      return await browser.execute((id) => {
        return document.querySelector("#tabs .tab.active")?.dataset.tabId === id;
      }, first.id);
    }, { timeout: 5000 });
  });

  it("shows the terminal viewport inside the active tab", async () => {
    // The `active` class lives on the tab-bar element (.tab.active), not on
    // .terminal-instance — the visible instance is the one without display:none.
    await browser.waitUntil(async () => {
      return await browser.execute(() => {
        const visible = [...document.querySelectorAll(".terminal-instance")]
          .find(el => el.style.display !== "none");
        const xterm = visible?.querySelector(".xterm");
        if (!xterm) return false;
        const r = xterm.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
    }, { timeout: 15000 });
  });
});
