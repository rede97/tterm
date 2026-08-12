// Keyboard shortcut system: quick open (Ctrl+P), MRU switching
// (Ctrl+Tab / Ctrl+Shift+Tab), zen mode (F11), close tab (Ctrl+W).
// Keybindings resolve from configStore (defaults here; rebinding is covered
// by tests/keymap.test.ts).

const activeTabId = () => browser.execute(() => window.__tterm.mgr.activeTabId);
const tabIds = () => browser.execute(() => [...window.__tterm.mgr.tabs.keys()]);
const mruTabIds = () => browser.execute(() => window.__tterm.mgr.mruTabIds());

async function ensureTabs(n) {
  await browser.execute(async (count) => {
    const mgr = window.__tterm.mgr;
    while (mgr.tabs.size < count) await mgr.createLocalTab();
  }, n);
  await browser.waitUntil(async () => (await tabIds()).length >= n, {
    timeout: 15000,
    timeoutMsg: `expected at least ${n} tabs`,
  });
}

describe("TTerm keyboard shortcuts", () => {
  it("Ctrl+P opens the quick-open list and a number jump switches tabs", async () => {
    await ensureTabs(3);
    const ids = await tabIds();
    await browser.execute((id) => window.__tterm.mgr.switchTo(id), ids[0]);
    await browser.pause(300);

    await browser.keys(["Control", "p"]);
    const input = await $(".tab-switcher-input");
    await input.waitForExist({ timeout: 5000 });

    // Rows carry the tab-strip numbers.
    const badges = await $$(".tab-switcher-row .tab-switcher-badge");
    expect(badges.length).toBeGreaterThanOrEqual(3);

    await browser.keys("2");
    await browser.keys("Enter");
    await browser.waitUntil(async () => !(await $(".tab-switcher-overlay").isExisting()), {
      timeout: 5000,
      timeoutMsg: "quick open did not close after Enter",
    });
    expect(await activeTabId()).toBe(ids[1]);
  });

  it("Ctrl+Tab switches to the most recently used tab on release", async () => {
    // Establish a known MRU: [front, second, ...] then expect "second".
    const ids = await tabIds();
    await browser.execute(
      (a, b) => {
        const mgr = window.__tterm.mgr;
        mgr.switchTo(a);
        mgr.switchTo(b);
      },
      ids[2],
      ids[0],
    );
    await browser.pause(200);
    const expected = (await mruTabIds())[1];

    await browser.keys(["Control", "Tab"]);
    await browser.waitUntil(async () => (await activeTabId()) === expected, {
      timeout: 5000,
      timeoutMsg: "Ctrl+Tab did not switch to the MRU tab",
    });
    // Overlay is gone after the commit.
    expect(await $(".tab-switcher-overlay").isExisting()).toBe(false);
  });

  it("Ctrl+Shift+Tab wraps to the least recently used tab", async () => {
    const mru = await mruTabIds();
    const leastRecent = mru[mru.length - 1];
    expect(mru.length).toBeGreaterThanOrEqual(3);

    await browser.keys(["Control", "Shift", "Tab"]);
    await browser.waitUntil(async () => (await activeTabId()) === leastRecent, {
      timeout: 5000,
      timeoutMsg: "Ctrl+Shift+Tab did not wrap to the least recent tab",
    });
  });

  it("F11 toggles full screen: tab bar hidden, restored on second press", async () => {
    await browser.keys(["F11"]);
    await browser.waitUntil(
      async () => await browser.execute(() => document.body.classList.contains("zen-mode")),
      { timeout: 5000, timeoutMsg: "full screen did not engage" },
    );
    expect(await $("#tab-bar").isDisplayed()).toBe(false);
    // Browser-style: the window covers the taskbar. The OS transition lags
    // the class flip — wait for it, but ALWAYS exit before asserting so a
    // failure can't strand the window in fullscreen for later tests.
    const covered = await browser
      .waitUntil(
        async () =>
          await browser.execute(() => window.outerHeight > screen.availHeight),
        { timeout: 5000 },
      )
      .then(() => true)
      .catch(() => false);

    await browser.keys(["F11"]);
    await browser.waitUntil(
      async () => await browser.execute(() => !document.body.classList.contains("zen-mode")),
      { timeout: 5000, timeoutMsg: "full screen did not disengage" },
    );
    expect(await $("#tab-bar").isDisplayed()).toBe(true);
    // Skip the coverage assertion when the session has no taskbar
    // (availHeight === height): the two are indistinguishable there.
    const hasTaskbar = await browser.execute(() => screen.availHeight < screen.height);
    if (hasTaskbar) expect(covered).toBe(true);
  });

  it("Shift+F11 toggles zen mode: maximized with the tab bar hidden", async () => {
    // Defensive: a previous failure could leave zen engaged.
    if (await browser.execute(() => document.body.classList.contains("zen-mode"))) {
      await browser.keys(["F11"]);
      await browser.waitUntil(
        async () => await browser.execute(() => !document.body.classList.contains("zen-mode")),
        { timeout: 5000 },
      );
    }
    await browser.keys(["Shift", "F11"]);
    await browser.waitUntil(
      async () => await browser.execute(() => document.body.classList.contains("zen-mode")),
      { timeout: 5000, timeoutMsg: "zen mode did not engage" },
    );
    expect(await $("#tab-bar").isDisplayed()).toBe(false);

    await browser.keys(["Shift", "F11"]);
    await browser.waitUntil(
      async () => await browser.execute(() => !document.body.classList.contains("zen-mode")),
      { timeout: 5000, timeoutMsg: "zen mode did not disengage" },
    );
    expect(await $("#tab-bar").isDisplayed()).toBe(true);
  });

  it("Ctrl+W closes the active tab", async () => {
    const before = (await tabIds()).length;
    expect(before).toBeGreaterThanOrEqual(2);
    await browser.keys(["Control", "w"]);
    await browser.waitUntil(async () => (await tabIds()).length === before - 1, {
      timeout: 5000,
      timeoutMsg: "Ctrl+W did not close the active tab",
    });
  });
});
