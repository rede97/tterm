// Command palette (Ctrl+Shift+P): opens with a fixed chrome ">" prefix,
// lists commands, runs one with Enter, and flips back to quick open when
// Backspace is pressed on an empty field. Page-stack flows (New Tab… →
// kind → target) and the temporary-SSH password step are covered by
// tests/palette.test.ts.

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

  it("Ctrl+Shift+P opens the palette and New Tab… creates a tab", async () => {
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
    expect(text).toContain("New Tab…");
    expect(text).toContain("Temporary Connect");
    expect(text).toContain("WINDOW");

    // New Tab… → Local → first profile (draft picker path).
    await input.click();
    await browser.keys("new tab");
    await browser.pause(200);
    const before = await browser.execute(() => window.__tterm.mgr.tabs.size);
    await browser.keys("Enter"); // New Tab…
    await browser.pause(200);
    await browser.keys("Enter"); // Local
    await browser.pause(200);
    await browser.keys("Enter"); // first local profile
    await browser.waitUntil(async () => !(await $(".pal-overlay").isExisting()), {
      timeout: 5000,
      timeoutMsg: "palette did not close after Enter",
    });
    await browser.waitUntil(
      async () => (await browser.execute(() => window.__tterm.mgr.tabs.size)) === before + 1,
      { timeout: 10000, timeoutMsg: "palette New Tab did not create a tab" },
    );
  });

  it("Backspace on empty flips back to quick open (tabs)", async () => {
    await browser.keys(["Control", "Shift", "p"]);
    const input = await $(".pal-panel .pal-input");
    await input.waitForExist({ timeout: 5000 });
    await browser.keys("Backspace"); // empty field + chrome ">" → quick open
    await browser.waitUntil(
      async () =>
        (await browser.execute(
          () => document.querySelector(".pal-input")?.placeholder ?? "",
        )) === "Go to tab — number or name; > for commands",
      { timeout: 5000, timeoutMsg: "did not flip back to quick open" },
    );
    await browser.keys("Escape");
  });
});
