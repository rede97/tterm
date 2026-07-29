// Anime TTY (gostty port) e2e: full-screen animation without external
// binaries. Also serves as the deterministic fixture for hidden-cursor and
// full-screen-repaint scenarios.

const dumpBuffer = () => browser.execute(() => {
  const visible = [...document.querySelectorAll(".terminal-instance")].find((el) => el.style.display !== "none");
  const tab = [...window.__tterm.tabs.values()].find((t) => t.element === visible);
  if (!tab) return "";
  const buf = tab.terminal.buffer.active;
  let out = "";
  for (let i = 0; i < buf.length; i++) out += buf.getLine(i)?.translateToString(true) ?? "";
  return out;
});

const cursorHidden = () => browser.execute(() => {
  const visible = [...document.querySelectorAll(".terminal-instance")].find((el) => el.style.display !== "none");
  const tab = [...window.__tterm.tabs.values()].find((t) => t.element === visible);
  return tab ? !!tab.terminal._core.coreService?.isCursorHidden : null;
});

async function openAnimeTab() {
  await $("#new-tab-menu-btn").click();
  const item = await browser.waitUntil(async () => {
    const items = await $$(".profile-menu .profile-item");
    for (const it of items) {
      const label = await it.$(".item-label").getText();
      if (label === "Anime TTY") return it;
    }
    return false;
  }, { timeout: 5000, timeoutMsg: "Anime TTY menu item not found (debug build?)" });
  await item.click();
  await browser.waitUntil(async () => (await dumpBuffer()).length > 100, { timeout: 10000 });
}

describe("Anime TTY (gostty port)", () => {
  it("renders gostty animation frames and advances over time", async () => {
    await openAnimeTab();
    // gostty frame content: density chars from the embedded frames
    await browser.waitUntil(async () => (await dumpBuffer()).includes("$@$"), {
      timeout: 10000,
      timeoutMsg: "gostty frame content not found in buffer",
    });
    const first = await dumpBuffer();
    await browser.pause(700); // ~20 frames at 35ms
    const second = await dumpBuffer();
    expect(second).not.toBe(first);
  });

  it("hides the hardware cursor while animating", async () => {
    expect(await cursorHidden()).toBe(true);
  });

  it("centers the animation for the live terminal size", async () => {
    // end-to-end chain: fit() -> pty_resize -> SerialCtl::SetSize -> render.
    // The gostty frames have their own internal left padding per row, so the
    // hpad shows up as the MINIMUM leading-space count across content lines.
    const pad = await browser.execute(() => {
      const visible = [...document.querySelectorAll(".terminal-instance")].find((el) => el.style.display !== "none");
      const tab = [...window.__tterm.tabs.values()].find((t) => t.element === visible);
      if (!tab) return null;
      const buf = tab.terminal.buffer.active;
      let minLead = Infinity;
      for (let i = 0; i < buf.length; i++) {
        const raw = buf.getLine(i)?.translateToString(false) ?? "";
        const line = raw.replace(/\s+$/, "");
        if (line.trim().length > 0) {
          minLead = Math.min(minLead, (line.match(/^ */) || [""])[0].length);
        }
      }
      return { minLead, cols: tab.terminal.cols };
    });
    expect(pad).not.toBeNull();
    const expected = Math.max(0, Math.floor((pad.cols - 77) / 2)); // gostty ImageWidth = 77
    // The captured frame's own minimum internal padding varies per frame
    // (0/2/4/6 across the 235 gostty frames), so assert the delta is one of
    // those known values — any stale/wrong centering falls outside the set.
    expect([0, 2, 4, 6]).toContain(pad.minLead - expected);
  });

  it("quits on q, restores the terminal, and respawns on Enter", async () => {
    await browser.execute(() => {
      [...document.querySelectorAll(".terminal-instance .xterm-helper-textarea")].pop().focus();
    });
    await browser.keys(["q"]);
    await browser.waitUntil(async () => (await dumpBuffer()).includes("anime session ended"), {
      timeout: 5000,
      timeoutMsg: "exit message not shown after q",
    });
    expect(await cursorHidden()).toBe(false);
    await browser.waitUntil(async () => (await dumpBuffer()).includes("Press Enter to reconnect"), {
      timeout: 5000,
      timeoutMsg: "dead-mode prompt missing",
    });
    await browser.keys(["Enter"]);
    await browser.waitUntil(async () => (await dumpBuffer()).includes("$@$"), {
      timeout: 5000,
      timeoutMsg: "animation did not restart after Enter",
    });
    expect(await cursorHidden()).toBe(true);
  });
});
