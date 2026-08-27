// Settings pseudo-tab: gear button and Ctrl+, (workbench.action.openSettings).

function settingsVisible() {
  return browser.execute(() => {
    const page = document.querySelector(".settings-page");
    return !!page && page.offsetParent !== null;
  });
}

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

async function closeSettings() {
  const btn = await $('button[aria-label="Close settings"]');
  if (await btn.isExisting()) await btn.click();
  await browser.waitUntil(async () => !(await settingsVisible()), {
    timeout: 5000,
    timeoutMsg: "settings page did not close",
  });
}

describe("TTerm settings chrome", () => {
  before(waitApp);

  it("the gear button opens the settings page", async () => {
    if (await settingsVisible()) await closeSettings();
    await $("#settings-btn").click();
    await browser.waitUntil(settingsVisible, {
      timeout: 10000,
      timeoutMsg: "#settings-btn did not open .settings-page",
    });
    expect(await settingsVisible()).toBe(true);
  });

  it("Ctrl+, opens settings after the page is closed", async () => {
    if (await settingsVisible()) await closeSettings();
    await browser.keys(["Control", ","]);
    await browser.waitUntil(settingsVisible, {
      timeout: 10000,
      timeoutMsg: "Ctrl+, did not open .settings-page",
    });
    expect(await settingsVisible()).toBe(true);
    await closeSettings();
  });
});
