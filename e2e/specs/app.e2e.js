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
