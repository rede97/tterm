// Command palette (Ctrl+Shift+P): opens with a fixed chrome ">" prefix,
// lists commands, runs one with Enter, and flips back to quick open when
// Backspace is pressed on an empty field. Page-stack flows (New Local Tab
// → profile) and Temporary Connect are covered by tests/palette.test.ts.

describe("TTerm command palette", () => {
  before(async () => {
    // Cold vite transform can outlast the first paint — wait for init.
    await browser.waitUntil(async () => browser.execute(() => !!window.__tterm), {
      timeout: 15000,
      timeoutMsg: "app did not init (no __tterm)",
    });
    // …and for the initial tab to settle — its late focus() would steal
    // the palette input mid-test.
    await browser.waitUntil(async () => browser.execute(() => window.__tterm.mgr.tabs.size >= 1), {
      timeout: 15000,
      timeoutMsg: "initial tab did not open",
    });
    await browser.pause(500);
  });

  it("Ctrl+Shift+P opens the palette and New Local Tab creates a tab", async () => {
    await browser.keys(["Control", "Shift", "p"]);
    const input = await $(".pal-panel .pal-input");
    await input.waitForExist({ timeout: 5000 });
    // Draft: ">" is chrome (.pal-prefix), not part of the input value.
    expect(await input.getValue()).toBe("");
    expect(await $(".pal-prefix.on").isExisting()).toBe(true);

    // Command rows render, grouped, with draft titles.
    const rows = await $$(".pal-row");
    expect(rows.length).toBeGreaterThan(5);
    const text = await $(".pal-panel").getText();
    expect(text).toContain("New Local Tab");
    expect(text).toContain("New SSH Tab");
    expect(text).toContain("New Serial Tab");
    expect(text).toContain("WINDOW");

    // New Local Tab → first profile (no kind picker).
    await input.click();
    await browser.keys("new local");
    await browser.pause(200);
    const before = await browser.execute(() => window.__tterm.mgr.tabs.size);
    await browser.keys("Enter"); // New Local Tab
    await browser.pause(200);
    await browser.keys("Enter"); // first local profile
    await browser.waitUntil(async () => !(await $(".pal-overlay").isExisting()), {
      timeout: 5000,
      timeoutMsg: "palette did not close after Enter",
    });
    await browser.waitUntil(
      async () => (await browser.execute(() => window.__tterm.mgr.tabs.size)) === before + 1,
      { timeout: 10000, timeoutMsg: "palette New Local Tab did not create a tab" },
    );
  });

  it("Backspace on empty flips back to quick open (tabs)", async () => {
    await browser.keys(["Control", "Shift", "p"]);
    const input = await $(".pal-panel .pal-input");
    await input.waitForExist({ timeout: 5000 });
    await input.click();
    await browser.keys("Backspace");
    await browser.waitUntil(async () => !(await $(".pal-prefix.on").isExisting()), {
      timeout: 3000,
      timeoutMsg: "did not flip to quick open",
    });
    expect(await $(".pal-panel .pal-input").isExisting()).toBe(true);
  });

  it("hides SSH/Serial session commands on a local tab", async () => {
    await browser.keys("Escape");
    await browser.waitUntil(async () => !(await $(".pal-overlay").isExisting()), {
      timeout: 3000,
      timeoutMsg: "palette did not close before filter test",
    });

    const kind = await browser.execute(() => {
      const mgr = window.__tterm.mgr;
      return mgr.get(mgr.activeTabId)?.type ?? null;
    });
    expect(kind).toBe("local");

    await browser.keys(["Control", "Shift", "p"]);
    const input = await $(".pal-panel .pal-input");
    await input.waitForExist({ timeout: 5000 });
    const unfiltered = await $(".pal-panel").getText();
    expect(unfiltered).toContain("New Local Tab");
    expect(unfiltered).not.toContain("Port Forward");
    expect(unfiltered).not.toContain("Baud");

    await input.click();
    await input.setValue("Port Forward");
    await browser.pause(200);
    const pf = await browser.execute(() =>
      [...document.querySelectorAll(".pal-row")].map((r) => r.textContent),
    );
    expect(pf.join("\n")).not.toMatch(/Port Forward/i);
    expect(await $(".pal-empty").isExisting()).toBe(true);

    await input.setValue("Baud");
    await browser.pause(200);
    const baud = await browser.execute(() =>
      [...document.querySelectorAll(".pal-row")].map((r) => r.textContent),
    );
    expect(baud.join("\n")).not.toMatch(/Baud/i);
    expect(await $(".pal-empty").isExisting()).toBe(true);

    await browser.keys("Escape");
  });
});
