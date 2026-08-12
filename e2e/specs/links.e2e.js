// Verifies link detection in the terminal: auto-detected http(s) URLs and
// explicit OSC 8 hyperlinks must both be recognized by the linkifier when
// hovered. Activation gating (plain click for OSC 8, Ctrl+click for plain
// URLs) is covered by tests/links.test.ts — actually opening the URL would
// launch a real browser on the test machine.

const PLAIN_URL = "https://example.com/some/page";
const OSC8_URL = "https://example.org/explicit";
const OSC8_TEXT = "Clickable-Link-Text";

async function textGeometry(marker) {
  return browser.execute((m) => {
    const mgr = window.__tterm.mgr;
    const tab = mgr.get(mgr.activeTabId);
    if (!tab) return null;
    const term = tab.terminal;
    const buf = term.buffer.active;
    for (let i = buf.length - 1; i >= 0; i--) {
      const line = buf.getLine(i);
      if (!line) continue;
      const text = line.translateToString(true);
      const col = text.indexOf(m);
      if (col >= 0) {
        const core = term._core;
        const cell = core._renderService.dimensions.css.cell;
        const screenEl = core.screenElement;
        const rect = screenEl.getBoundingClientRect();
        const cs = getComputedStyle(screenEl);
        return {
          row: i - buf.viewportY,
          col,
          len: m.length,
          cellW: cell.width,
          cellH: cell.height,
          originX: rect.left + (parseInt(cs.paddingLeft, 10) || 0),
          originY: rect.top + (parseInt(cs.paddingTop, 10) || 0),
        };
      }
    }
    return null;
  }, marker);
}

// The link currently under the mouse, as seen by xterm's linkifier
// (_linkifier is a leak-guard wrapper; the real object is behind .value).
async function hoveredLink() {
  return browser.execute(() => {
    const mgr = window.__tterm.mgr;
    const tab = mgr.get(mgr.activeTabId);
    if (!tab) return null;
    const linkifier = tab.terminal._core._linkifier?.value ?? tab.terminal._core._linkifier;
    const current = linkifier?.currentLink;
    return current ? current.link.text : null;
  });
}

async function hoverOver(marker) {
  const g = await textGeometry(marker);
  expect(g).not.toBeNull();
  const x = Math.round(g.originX + (g.col + Math.min(g.len, 8)) * g.cellW + 2);
  const y = Math.round(g.originY + g.row * g.cellH + g.cellH / 2);
  // Nudge in two steps so the linkifier definitely sees a cell change.
  await browser
    .action("pointer")
    .move({ x: x - 1, y })
    .perform();
  await browser.action("pointer").move({ x, y }).perform();
  await browser.waitUntil(async () => (await hoveredLink()) !== null, {
    timeout: 5000,
    timeoutMsg: `no link detected when hovering "${marker}"`,
  });
}

describe("terminal clickable links", () => {
  it("detects auto URLs and OSC 8 hyperlinks on hover", async () => {
    await $("#tab-bar").waitForExist({ timeout: 20000 });
    await browser.waitUntil(async () => (await $$("#tabs .tab")).length >= 1, {
      timeout: 20000,
      timeoutMsg: "initial tab did not appear",
    });
    await browser.pause(1200); // let the shell print its prompt

    // Write both link flavors straight into the terminal buffer (typing an
    // OSC 8 escape sequence through a shell is needlessly fragile).
    await browser.execute(
      (plain, osc8url, osc8text) => {
        const mgr = window.__tterm.mgr;
        const tab = mgr.get(mgr.activeTabId);
        tab.terminal.write(
          `${plain}\r\n` + `\x1b]8;;${osc8url}\x1b\\${osc8text}\x1b]8;;\x1b\\\r\n`,
        );
      },
      PLAIN_URL,
      OSC8_URL,
      OSC8_TEXT,
    );

    // Auto-detected plain URL.
    await browser.waitUntil(async () => (await textGeometry(PLAIN_URL)) !== null, {
      timeout: 5000,
      timeoutMsg: "plain URL not found in terminal buffer",
    });
    await hoverOver(PLAIN_URL);
    expect(await hoveredLink()).toBe(PLAIN_URL);

    // Explicit OSC 8 hyperlink: hovering the visible text yields its URI.
    await browser.waitUntil(async () => (await textGeometry(OSC8_TEXT)) !== null, {
      timeout: 5000,
      timeoutMsg: "OSC 8 link text not found in terminal buffer",
    });
    await hoverOver(OSC8_TEXT);
    expect(await hoveredLink()).toBe(OSC8_URL);
  });
});
