// Terminal Find: Shift+right-click (plain right-click is copy/paste), then Find.

async function waitApp() {
  await browser.waitUntil(async () => browser.execute(() => !!window.__tterm), {
    timeout: 15000,
    timeoutMsg: "app did not init (no __tterm)",
  });
  await browser.waitUntil(async () => browser.execute(() => window.__tterm.mgr.tabs.size >= 1), {
    timeout: 15000,
    timeoutMsg: "initial tab did not open",
  });
  await browser.pause(400);
}

function openTermMenu() {
  return browser.execute(() => {
    const visible = [...document.querySelectorAll(".terminal-instance")].find(
      (el) => el.style.display !== "none",
    );
    if (!visible) return false;
    const rc = visible.getBoundingClientRect();
    visible.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        shiftKey: true,
        clientX: Math.round(rc.left + 200),
        clientY: Math.round(rc.top + 100),
      }),
    );
    return true;
  });
}

describe("TTerm find bar", () => {
  before(waitApp);

  it("terminal Find opens the bar, types, and closes", async () => {
    await openTermMenu();
    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          const menu = document.getElementById("tab-context-menu");
          return (
            !!menu &&
            [...menu.querySelectorAll(".menu-item")].some((i) => i.textContent === "Find")
          );
        }),
      { timeout: 5000, timeoutMsg: "context menu with Find did not open" },
    );
    await browser.execute(() => {
      const menu = document.getElementById("tab-context-menu");
      const item = [...menu.querySelectorAll(".menu-item")].find((i) => i.textContent === "Find");
      item.click();
    });

    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          const bar = document.getElementById("search-bar");
          const input = bar?.querySelector("input");
          return bar?.style.display === "flex" && document.activeElement === input;
        }),
      { timeout: 5000, timeoutMsg: "search bar did not show or focus" },
    );

    const input = await $("#search-bar input");
    await input.setValue("prompt");
    expect(await input.getValue()).toBe("prompt");
    expect(await $('button[aria-label="Previous match"]').isExisting()).toBe(true);
    expect(await $('button[aria-label="Next match"]').isExisting()).toBe(true);

    await $('button[aria-label="Close search"]').click();
    await browser.waitUntil(
      async () =>
        browser.execute(() => document.getElementById("search-bar")?.style.display === "none"),
      { timeout: 5000, timeoutMsg: "search bar did not close" },
    );
  });
});
