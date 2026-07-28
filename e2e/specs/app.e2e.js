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

  it("prints in-band disconnect prompt on session exit and respawns on Enter", async () => {
    // Backend dead-mode: killing the shell prints a reset+notice INTO the
    // terminal stream (no overlay), the tab label gets a strikethrough, and
    // pressing Enter — a normal keystroke over the socket — respawns.
    const firstTab = await $("#tabs .tab");
    await firstTab.click();
    await browser.pause(500);
    // click the terminal viewport to guarantee xterm's textarea has focus
    const viewport = await $(".terminal-instance .xterm");
    await viewport.click();
    await browser.pause(300);
    await browser.keys(["e", "x", "i", "t", "Enter"]);

    // shell exits -> backend prints the prompt into the terminal buffer…
    const dumpBuffer = () => browser.execute(() => {
      const visible = [...document.querySelectorAll(".terminal-instance")]
        .find(el => el.style.display !== "none");
      const tab = [...(window).__tterm.tabs.values()]
        .find(t => t.element === visible);
      if (!tab) return "";
      const buf = tab.terminal.buffer.active;
      let out = "";
      for (let i = 0; i < buf.length; i++) out += buf.getLine(i)?.translateToString(true) ?? "";
      return out;
    });
    await browser.waitUntil(async () => {
      return (await dumpBuffer()).includes("Press Enter to reconnect");
    }, { timeout: 10000, timeoutMsg: "in-band disconnect prompt not printed into terminal" });

    // …and the tab label shows the dead state (driven by the backend event)
    await browser.waitUntil(async () => {
      return await browser.execute(() =>
        [...document.querySelectorAll("#tabs .tab")].some(t => t.classList.contains("disconnected")));
    }, { timeout: 5000, timeoutMsg: "tab did not get the disconnected style" });

    // Enter is just a keystroke: the backend respawns the shell in place.
    await browser.keys("Enter");
    await browser.waitUntil(async () => {
      return await browser.execute(() =>
        [...document.querySelectorAll("#tabs .tab")].every(t => !t.classList.contains("disconnected")));
    }, { timeout: 10000, timeoutMsg: "tab did not recover after Enter" });

    // A fresh ConPTY always opens with ESC[2J (erase visible display). The
    // backend scrolls the dead viewport into scrollback first, so nothing
    // is lost: the disconnect prompt must still be in the buffer.
    await browser.waitUntil(async () => {
      return (await dumpBuffer()).includes("Press Enter to reconnect");
    }, { timeout: 5000, timeoutMsg: "disconnect prompt was lost on respawn (not scrolled into scrollback)" });

    // The respawned shell actually works.
    await browser.pause(500);
    await viewport.click();
    await browser.pause(200);
    await browser.keys(["e", "c", "h", "o", " ", "R", "E", "S", "P", "A", "W", "N", "O", "K", "Enter"]);
    await browser.waitUntil(async () => {
      return (await dumpBuffer()).includes("RESPAWNOK");
    }, { timeout: 10000, timeoutMsg: "respawned shell did not answer" });
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

  it("output newline cr-in-lf fixes LF-only staircase (MOCK-NL end-to-end)", async () => {
    await $("#new-tab-menu-btn").click();
    await browser.waitUntil(async () => {
      return await browser.execute(() => {
        const items = [...document.querySelectorAll(".profile-menu .profile-item")];
        return items.some(i => i.querySelector(".item-label")?.textContent?.includes("MOCK-NL"));
      });
    }, { timeout: 8000 });
    await browser.execute(() => {
      const items = [...document.querySelectorAll(".profile-menu .profile-item")];
      const hit = items.find(i => i.querySelector(".item-label")?.textContent?.includes("MOCK-NL"));
      if (hit) hit.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const dumpLines = () => browser.execute(() => {
      for (const [, tab] of (window).__tterm.tabs.entries()) {
        if (tab.label && tab.label.includes("MOCK-NL")) {
          const buf = tab.terminal.buffer.active;
          const lines = [];
          for (let i = 0; i < buf.length; i++) lines.push(buf.getLine(i)?.translateToString(false) ?? "");
          return lines;
        }
      }
      return [];
    });

    // wait for the LF-only block [2] in raw mode: beta should be staircased
    await browser.waitUntil(async () => {
      const lines = await dumpLines();
      return lines.some(l => l.includes("[2]")) && lines.some(l => /^ +beta/.test(l));
    }, { timeout: 15000, timeoutMsg: "raw staircase block [2] not seen" });

    // switch output newlines to cr-in-lf, clear, wait for the block to cycle back
    await browser.execute(() => {
      for (const [id, tab] of (window).__tterm.tabs.entries()) {
        if (tab.label && tab.label.includes("MOCK-NL")) {
          (window).__tterm.mgr.setSerialOutputNewline(id, "cr-in-lf");
          tab.terminal.clear();
        }
      }
    });

    await browser.waitUntil(async () => {
      const lines = await dumpLines();
      return lines.some(l => l.includes("[2]")) && lines.some(l => /^beta\s*$/.test(l));
    }, { timeout: 20000, timeoutMsg: "cr-in-lf did not de-staircase block [2]" });

    // and no staircased beta remains
    const lines = await dumpLines();
    expect(lines.some(l => /^ +beta/.test(l))).toBe(false);
  });

  it("shift+right-click Clear empties scrollback but keeps the prompt line", async () => {
    // VS Code semantics: xterm clear() wipes scrollback + viewport but
    // preserves the cursor's line (the prompt), so typing continues without
    // needing to press Enter first.
    const firstTab = await $("#tabs .tab");
    await firstTab.click();
    await browser.pause(400);
    await browser.execute(() => {
      const visible = [...document.querySelectorAll(".terminal-instance")]
        .find(el => el.style.display !== "none");
      const tab = [...(window).__tterm.tabs.values()].find(t => t.element === visible);
      tab.terminal.focus();
      return 1;
    });
    await browser.pause(200);

    // produce some scrollback
    await browser.keys(["e", "c", "h", "o", " ", "C", "L", "E", "A", "R", "M", "A", "R", "K", "1", "Enter"]);
    await browser.keys(["e", "c", "h", "o", " ", "C", "L", "E", "A", "R", "M", "A", "R", "K", "2", "Enter"]);
    const dumpBuffer = () => browser.execute(() => {
      const visible = [...document.querySelectorAll(".terminal-instance")]
        .find(el => el.style.display !== "none");
      const tab = [...(window).__tterm.tabs.values()].find(t => t.element === visible);
      if (!tab) return "\n0";
      const buf = tab.terminal.buffer.active;
      let out = "";
      for (let i = 0; i < buf.length; i++) out += buf.getLine(i)?.translateToString(true) ?? "";
      return out + "\n" + buf.baseY;
    });
    await browser.waitUntil(async () => (await dumpBuffer()).includes("CLEARMARK2"), { timeout: 10000 });

    // shift+right-click on the terminal -> context menu -> Clear
    await browser.execute(() => {
      const visible = [...document.querySelectorAll(".terminal-instance")]
        .find(el => el.style.display !== "none");
      const rc = visible.getBoundingClientRect();
      visible.dispatchEvent(new MouseEvent("contextmenu", {
        bubbles: true, cancelable: true, shiftKey: true,
        clientX: Math.round(rc.left + 200), clientY: Math.round(rc.top + 100),
      }));
      return 1;
    });
    await browser.waitUntil(async () => {
      return await browser.execute(() => {
        const menu = document.getElementById("tab-context-menu");
        return !!menu && [...menu.querySelectorAll(".menu-item")]
          .some(i => i.textContent === "Clear");
      });
    }, { timeout: 5000, timeoutMsg: "context menu with Clear item did not open" });
    await browser.execute(() => {
      const menu = document.getElementById("tab-context-menu");
      const item = [...menu.querySelectorAll(".menu-item")].find(i => i.textContent === "Clear");
      item.click();
      return 1;
    });

    // scrollback wiped (baseY = 0), old marks gone, prompt line preserved
    await browser.waitUntil(async () => {
      const dump = await dumpBuffer();
      const baseY = parseInt(dump.trim().split("\n").pop() || "99", 10);
      return baseY === 0 && !dump.includes("CLEARMARK1") && !dump.includes("CLEARMARK2");
    }, { timeout: 5000, timeoutMsg: "scrollback was not wiped" });
    const afterClear = await dumpBuffer();
    expect(afterClear.trim().length).toBeGreaterThan(0);

    // typing continues immediately: the shell echoes without any extra Enter
    await browser.keys(["e", "c", "h", "o", " ", "A", "F", "T", "E", "R", "C", "L", "E", "A", "R", "Enter"]);
    await browser.waitUntil(async () => (await dumpBuffer()).includes("AFTERCLEAR"), {
      timeout: 10000, timeoutMsg: "shell did not echo after clear (prompt lost?)",
    });
  });

  it("tabs are equal width and carry the full name in the hover tooltip", async () => {
    // Equal sizing (Chrome/WT style): every .tab shares the same width at
    // any moment, CAPPED at 200px even when a single tab could fill the
    // whole bar; the full label lives in the title attribute.
    await browser.waitUntil(async () => (await $$("#tabs .tab")).length >= 1, { timeout: 15000 });
    const single = await browser.execute(() =>
      Math.round(document.querySelector("#tabs .tab").getBoundingClientRect().width));
    expect(single).toBeLessThanOrEqual(200);
    expect(single).toBeGreaterThanOrEqual(120);

    await browser.waitUntil(async () => (await $$("#tabs .tab")).length >= 3, { timeout: 15000 });
    const info = await browser.execute(() =>
      [...document.querySelectorAll("#tabs .tab")].map(t => ({
        w: Math.round(t.getBoundingClientRect().width),
        label: t.querySelector(".tab-label")?.textContent ?? "",
        title: t.title,
      })));
    expect(info.length).toBeGreaterThanOrEqual(3);
    const widths = new Set(info.map(t => t.w));
    expect(widths.size).toBe(1);
    for (const t of info) {
      expect(t.w).toBeLessThanOrEqual(200);
      expect(t.title).toBe(t.label);
      expect(t.title.length).toBeGreaterThan(0);
    }
  });

  it("keeps the new-tab buttons flush against the last tab", async () => {
    // The + / dropdown group lives inside #tabs as the last flex item, so
    // it must sit immediately right of the last tab regardless of count.
    await browser.waitUntil(async () => (await $$("#tabs .tab")).length >= 2, { timeout: 15000 });
    const gap = await browser.execute(() => {
      const tabs = [...document.querySelectorAll("#tabs .tab")];
      const last = tabs[tabs.length - 1].getBoundingClientRect();
      const btn = document.getElementById("new-tab-group").getBoundingClientRect();
      return Math.round(btn.left - last.right);
    });
    expect(Math.abs(gap)).toBeLessThanOrEqual(1);
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
