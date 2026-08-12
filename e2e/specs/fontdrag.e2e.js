// Font fallback chain drag reorder: the "Used fonts" list in the font
// picker is SortableJS-driven (same setup as the tab bar). Drag the second
// entry above the first and the order must swap — in the DOM and in the
// dialog state (Apply would persist it).

async function selectedFonts() {
  return browser.execute(() =>
    [...document.querySelectorAll("#fp-selected .fp-selected-item")].map((el) => el.dataset.family),
  );
}

async function rowGeometry(index) {
  return browser.execute((i) => {
    const rows = [...document.querySelectorAll("#fp-selected .fp-selected-item")];
    const el = rows[i];
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      x: Math.round(r.left + r.width / 2),
      y: Math.round(r.top + r.height / 2),
      h: r.height,
    };
  }, index);
}

describe("font picker fallback chain", () => {
  it("reorders fonts by dragging", async () => {
    await $("#tab-bar").waitForExist({ timeout: 20000 });
    await browser.waitUntil(async () => (await $$("#tabs .tab")).length >= 1, {
      timeout: 20000,
      timeoutMsg: "initial tab did not appear",
    });

    // Settings → Appearance → Font Settings dialog.
    await $("#settings-btn").click();
    const navAppearance = await $('.settings-nav-item[data-panel="appearance"]');
    await navAppearance.waitForExist({ timeout: 10000 });
    await navAppearance.click();
    await $("#set-font-config").click();
    await $(".font-picker-overlay").waitForExist({ timeout: 10000 });

    // The default stack ships several fonts — need at least two rows.
    await browser.waitUntil(async () => (await $$("#fp-selected .fp-selected-item")).length >= 2, {
      timeout: 10000,
      timeoutMsg: "fallback chain did not render",
    });

    const before = await selectedFonts();
    const g0 = await rowGeometry(0);
    const g1 = await rowGeometry(1);
    expect(g0).not.toBeNull();
    expect(g1).not.toBeNull();

    // Drag row 1 above row 0. fallbackTolerance is 5px, so move well past
    // it before crossing the target; land slightly above row 0's center.
    await browser
      .action("pointer")
      .move({ x: g1.x, y: g1.y })
      .down()
      .pause(80)
      .move({ x: g1.x, y: g1.y - 10, duration: 60 })
      .move({ x: g0.x, y: g0.y - Math.round(g0.h / 2) - 2, duration: 200 })
      .pause(120)
      .up()
      .perform();
    await browser.pause(300);

    const after = await selectedFonts();
    expect(after.length).toBe(before.length);
    expect(after[0]).toBe(before[1]);
    expect(after[1]).toBe(before[0]);

    // Dismiss so other specs start clean.
    await browser.execute(() => document.querySelector(".font-picker-overlay")?.remove());
  });
});
