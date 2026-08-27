// Tab context menu Close Right / Close Others actually drop tabs.
// These paths call closeTab directly — the × confirm is not involved.

const tabIds = () => browser.execute(() => [...window.__tterm.mgr.tabs.keys()]);

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

function openTabMenu(index) {
  return browser.execute((i) => {
    const tabs = [...document.querySelectorAll("#tabs .tab[data-tab-id]")].filter(
      (el) => el.dataset.tabId !== "#settings",
    );
    const tab = tabs[i];
    if (!tab) return false;
    const rc = tab.getBoundingClientRect();
    tab.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: Math.round(rc.left + 8),
        clientY: Math.round(rc.top + 8),
      }),
    );
    return tab.dataset.tabId;
  }, index);
}

async function clickMenu(label) {
  await browser.waitUntil(
    async () =>
      browser.execute((text) => {
        const menu = document.getElementById("tab-context-menu");
        return (
          !!menu &&
          menu.classList.contains("open") &&
          [...menu.querySelectorAll(".menu-item")].some((i) => i.textContent === text)
        );
      }, label),
    { timeout: 5000, timeoutMsg: `context menu with ${label} did not open` },
  );
  await browser.execute((text) => {
    const menu = document.getElementById("tab-context-menu");
    const item = [...menu.querySelectorAll(".menu-item")].find((i) => i.textContent === text);
    item.click();
  }, label);
}

describe("TTerm tab context menu", () => {
  before(waitApp);

  it("Close Right keeps the clicked tab and drops every tab to its right", async () => {
    await ensureTabs(3);
    const before = await tabIds();
    expect(before.length).toBeGreaterThanOrEqual(3);
    const keep = await openTabMenu(0);
    await clickMenu("Close Right");
    await browser.waitUntil(async () => (await tabIds()).length === 1, {
      timeout: 10000,
      timeoutMsg: "Close Right did not leave a single tab",
    });
    expect(await tabIds()).toEqual([keep]);
  });

  it("Close Others keeps only the clicked tab", async () => {
    await ensureTabs(3);
    const before = await tabIds();
    expect(before.length).toBeGreaterThanOrEqual(3);
    const keep = await openTabMenu(1);
    await clickMenu("Close Others");
    await browser.waitUntil(async () => (await tabIds()).length === 1, {
      timeout: 10000,
      timeoutMsg: "Close Others did not leave a single tab",
    });
    expect(await tabIds()).toEqual([keep]);
  });
});
