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

  it("switches tabs when clicking the bottom edge of an inactive tab", async () => {
    // Regression: the full tab surface must be clickable, including pixels
    // below the title text (no overlay/scrollbar dead zones).
    const btn = await $("#new-tab");
    if ((await $$("#tabs .tab")).length < 2) await btn.click();
    await browser.waitUntil(async () => (await $$("#tabs .tab")).length >= 2, { timeout: 15000 });

    const first = await browser.execute(() => {
      const tab = document.querySelector("#tabs .tab");
      const rc = tab.getBoundingClientRect();
      return { id: tab.dataset.tabId, x: Math.round(rc.left + rc.width / 2), y: Math.round(rc.bottom - 2) };
    });
    await browser.action("pointer").move({ x: first.x, y: first.y }).down().up().perform();
    await browser.waitUntil(async () => {
      return await browser.execute((id) => {
        return document.querySelector("#tabs .tab.active")?.dataset.tabId === id;
      }, first.id);
    }, { timeout: 5000 });
  });

  it("demo TTY tab renders TUI frames and OSC 9;4 progress bar", async () => {
    // Open the new-tab menu and click "Demo TTY"
    await $("#new-tab-menu-btn").click();
    const demoItem = await browser.waitUntil(async () => {
      const items = await $$(".profile-menu .profile-item");
      for (const it of items) {
        const label = await it.$(".item-label").getText();
        if (label === "Demo TTY") return it;
      }
      return false;
    }, { timeout: 5000 });
    await demoItem.click();

    // A new tab opens and, within a few frames, gets a .tab-progress bar
    const before = (await $$("#tabs .tab")).length;
    await browser.waitUntil(async () => {
      const bars = await $$("#tabs .tab .tab-progress");
      return bars.length > 0 && (await $$("#tabs .tab")).length >= before;
    }, { timeout: 10000, timeoutMsg: "no .tab-progress appeared on demo tab" });
  });

  it("shows disconnect overlay on session exit and reconnects with Enter", async () => {
    // Use the first (local shell) tab: type exit to kill the shell
    const firstTab = await $("#tabs .tab");
    await firstTab.click();
    await browser.pause(500);
    // click the terminal viewport to guarantee xterm's textarea has focus
    const viewport = await $(".terminal-instance .xterm");
    await viewport.click();
    await browser.pause(300);
    await browser.keys(["e", "x", "i", "t", "Enter"]);

    // shell exits -> PTY EOF -> WS close -> overlay appears
    await browser.waitUntil(async () => {
      return await browser.execute(() => {
        const ov = document.querySelector(".disconnect-overlay");
        return ov && ov.style.display !== "none";
      });
    }, { timeout: 10000, timeoutMsg: "disconnect overlay did not appear" });

    // Enter triggers session_reconnect -> overlay disappears
    await browser.keys("Enter");
    await browser.waitUntil(async () => {
      return await browser.execute(() => {
        const ovs = [...document.querySelectorAll(".disconnect-overlay")];
        return ovs.every(o => o.style.display === "none");
      });
    }, { timeout: 10000, timeoutMsg: "overlay did not disappear after Enter" });
  });

  it("reorders tabs via drag (SortableJS)", async () => {
    const btn = await $("#new-tab");
    if ((await $$("#tabs .tab")).length < 2) await btn.click();
    await browser.waitUntil(async () => (await $$("#tabs .tab")).length >= 2, { timeout: 15000 });

    const rects = await browser.execute(() =>
      [...document.querySelectorAll("#tabs .tab")].map(t => {
        const r = t.getBoundingClientRect();
        return { id: t.dataset.tabId, x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }));
    const [t1, t2] = rects;

    // drag the 2nd tab left past the 1st tab's midpoint (multi-step: Sortable
    // needs a realistic pointermove sequence)
    const startX = Math.round(t2.x), endX = Math.round(t1.x - 60), y = Math.round(t1.y);
    const action = browser.action("pointer")
      .move({ x: startX, y })
      .down()
      .pause(120);
    const steps = 8;
    for (let i = 1; i <= steps; i++) {
      action.move({ x: Math.round(startX + (endX - startX) * i / steps), y, duration: 60 }).pause(40);
    }
    await action.pause(200).up().perform();
    await browser.pause(400);

    const order = await browser.execute(() =>
      [...document.querySelectorAll("#tabs .tab")].map(t => t.dataset.tabId));
    expect(order[0]).toBe(t2.id);
  });

  it("mock serial loopback echoes typed input (debug enumeration)", async () => {
    // debug builds enumerate MOCK-LOOP via serial_list_ports like real hardware.
    // NOTE: the menu re-populates when async enumeration resolves, so query and
    // click the live element in one execute (wdio element handles go stale).
    await $("#new-tab-menu-btn").click();
    await browser.waitUntil(async () => {
      return await browser.execute(() => {
        const items = [...document.querySelectorAll(".profile-menu .profile-item")];
        return items.some(i => i.querySelector(".item-label")?.textContent?.includes("MOCK-LOOP"));
      });
    }, { timeout: 8000 });
    await browser.execute(() => {
      const items = [...document.querySelectorAll(".profile-menu .profile-item")];
      const hit = items.find(i => i.querySelector(".item-label")?.textContent?.includes("MOCK-LOOP"));
      if (hit) hit.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await browser.pause(800);
    // focus the mock tab's terminal explicitly (earlier tests may leave focus elsewhere)
    await browser.execute(() => {
      for (const [, tab] of (window).__tterm.tabs.entries()) {
        if (tab.label && tab.label.includes("MOCK")) tab.terminal.focus();
      }
    });
    await browser.keys(["H", "I", "M", "O", "C", "K"]);
    await browser.pause(600);
    const text = await browser.execute(() => {
      for (const [, tab] of (window).__tterm.tabs.entries()) {
        if (tab.label && tab.label.includes("MOCK")) {
          const buf = tab.terminal.buffer.active;
          let out = "";
          for (let i = 0; i < buf.length; i++) out += buf.getLine(i)?.translateToString(true) ?? "";
          return out;
        }
      }
      return "";
    });
    expect(text).toContain("HIMOCK");
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
