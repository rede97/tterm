// Quick-status button + panel, end to end: real app window, real backend.
// Covers tab-bar placement, the AI Share toggle (real share creation), and
// the serial section (mock loopback port) with live RTS/CTS and
// auto-reconnect IPC roundtrips.
describe("Quick-status button and panel", () => {
  it("groups with the park-to-tray button ahead of the window controls, divided from minimize", async () => {
    await browser.waitUntil(async () => (await $$("#tabs .tab")).length >= 1, { timeout: 15000 });
    const layout = await browser.execute(() => {
      const qs = document.getElementById("quick-status");
      const park = document.getElementById("btn-park-tray");
      const min = document.getElementById("btn-minimize");
      const group = document.getElementById("quick-actions");
      const dividers = [...document.querySelectorAll(".win-divider")];
      const innerDiv = dividers.find((d) => group.contains(d));
      const outerDiv = dividers.find((d) => !group.contains(d));
      const qsRect = qs.getBoundingClientRect();
      const parkRect = park.getBoundingClientRect();
      const divRect = outerDiv.getBoundingClientRect();
      const innerRect = innerDiv ? innerDiv.getBoundingClientRect() : null;
      const minRect = min.getBoundingClientRect();
      return {
        // Both buttons live in the shared group, quick-status first, with a
        // vertical divider between them.
        grouped: group.contains(qs) && group.contains(park),
        order: innerRect
          ? qsRect.right <= innerRect.left && innerRect.right <= parkRect.left
          : false,
        sameWidth: Math.abs(qsRect.width - parkRect.width) < 1,
        // All four bar buttons share one width.
        allFourWidth: (() => {
          const nt = document.getElementById("new-tab").getBoundingClientRect().width;
          const dd = document.getElementById("new-tab-menu-btn").getBoundingClientRect().width;
          return Math.abs(nt - qsRect.width) < 1 && Math.abs(dd - qsRect.width) < 1;
        })(),
        // Vertical divider sits between the group and minimize.
        divided: parkRect.right <= divRect.left && divRect.right <= minRect.left,
        dividerVertical: divRect.height > divRect.width,
      };
    });
    expect(layout.grouped).toBe(true);
    expect(layout.order).toBe(true);
    expect(layout.sameWidth).toBe(true);
    expect(layout.allFourWidth).toBe(true);
    expect(layout.divided).toBe(true);
    expect(layout.dividerVertical).toBe(true);
  });

  it("is disabled while the settings page is showing, re-enabled on close", async () => {
    const isDisabled = () =>
      browser.execute(() => document.getElementById("quick-status").disabled);
    expect(await isDisabled()).toBe(false);
    await browser.execute(() => window.__tterm.mgr.toggleSettings());
    await browser.waitUntil(async () => (await isDisabled()) === true, {
      timeout: 5000,
      timeoutMsg: "quick-status not disabled with settings open",
    });
    await browser.execute(() => window.__tterm.mgr.closeSettings(true));
    await browser.waitUntil(async () => (await isDisabled()) === false, {
      timeout: 5000,
      timeoutMsg: "quick-status not re-enabled after closing settings",
    });
  });

  it("opens the panel with an AI Share section for the active tab", async () => {
    await browser.execute(() => document.getElementById("quick-status").click());
    const panel = await $(".quick-panel.open");
    await panel.waitForExist({ timeout: 5000 });
    expect(await (await $('.quick-panel [data-section="share"]')).isExisting()).toBe(true);
    // A local shell tab has neither SSH nor serial sections.
    expect(await (await $('.quick-panel [data-section="ssh"]')).isExisting()).toBe(false);
    expect(await (await $('.quick-panel [data-section="serial"]')).isExisting()).toBe(false);
  });

  it("share toggle creates a real share and shows the copyable link", async () => {
    await browser.execute(() => {
      const row = document.querySelector('.quick-panel [data-section="share"] .qp-toggle-row');
      row.querySelector(".qp-switch").click();
    });
    await browser.waitUntil(
      async () => {
        return await browser.execute(() => !!document.querySelector(".quick-panel .qp-share-url"));
      },
      { timeout: 5000, timeoutMsg: "share URL row did not appear after toggle" },
    );

    const state = await browser.execute(() => {
      const mgr = window.__tterm.mgr;
      const tab = mgr.get(mgr.activeTabId);
      return {
        shared: tab.shared,
        url: document.querySelector(".quick-panel .qp-share-url").textContent,
        dot: document.getElementById("quick-status").dataset.state,
      };
    });
    expect(state.shared).toBe(true);
    expect(state.url).toContain("http://127.0.0.1");
    expect(state.dot).toBe("shared");

    // Toggle back off (cleanup for other specs sharing the window).
    await browser.execute(() => {
      const row = document.querySelector('.quick-panel [data-section="share"] .qp-toggle-row');
      row.querySelector(".qp-switch").click();
    });
    await browser.waitUntil(
      async () => {
        return await browser.execute(() => {
          const mgr = window.__tterm.mgr;
          return !mgr.get(mgr.activeTabId).shared;
        });
      },
      { timeout: 5000 },
    );

    await browser.execute(() => document.getElementById("quick-status").click()); // close
  });

  it("serial tab: profile select, live params, flow signals on demand", async () => {
    // Mock loopback port (debug builds inject it into serial_list_ports).
    await browser.executeAsync((done) => {
      (async () => {
        const mgr = window.__tterm.mgr;
        const tab = await mgr.createSerialTab({
          name: "MOCK-LOOP",
          driver: "tterm-mock",
          manufacturer: "TTerm",
          product: "Mock Loopback (echo)",
          vid: "",
          pid: "",
        });
        done(!!tab);
      })();
    });
    await browser.execute(() => document.getElementById("quick-status").click());
    const sec = await $('.quick-panel.open [data-section="serial"]');
    await sec.waitForExist({ timeout: 5000 });

    // Row order: Profile first, then baud, auto-reconnect, live params, flow.
    const info = await browser.execute(() => {
      const sec = document.querySelector('.quick-panel [data-section="serial"]');
      const selects = [...sec.querySelectorAll("select")].map((s) => s.getAttribute("aria-label"));
      return { selects, text: sec.textContent };
    });
    expect(info.selects).toEqual([
      "Profile",
      "Baud rate",
      "Input mode",
      "Enter sends",
      "Output newlines",
      "Flow control",
    ]);
    expect(info.text).toContain("Auto-reconnect");

    // Default profile Normal, flow none: the signal block is visible too —
    // open drives no modem line, so the toggles are the only way to raise
    // RTS/DTR (CDC-ACM devices that gate TX on DTR need this).
    const earlySignals = await browser.execute(() => {
      const sec = document.querySelector('.quick-panel [data-section="serial"]');
      return {
        toggles: sec.querySelectorAll(".qp-signals .qp-toggle-row").length,
        vals: sec.querySelectorAll(".qp-signals .qp-line-val").length,
      };
    });
    expect(earlySignals.toggles).toBe(2);
    expect(earlySignals.vals).toBe(2);

    // Switch profile to AT: the section re-renders with its parameters
    // (line-by-line input, CRLF enter) reflected in the live selects.
    await browser.execute(() => {
      const sel = document.querySelector(
        '.quick-panel [data-section="serial"] select[aria-label="Profile"]',
      );
      sel.value = "AT";
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await browser.waitUntil(
      () =>
        browser.execute(() => {
          const mgr = window.__tterm.mgr;
          const tab = mgr.get(mgr.activeTabId);
          const inputSel = document.querySelector(
            '.quick-panel [data-section="serial"] select[aria-label="Input mode"]',
          );
          return (
            tab.serialProfile === "AT" &&
            tab.inputMode === "line" &&
            inputSel &&
            inputSel.value === "line"
          );
        }),
      { timeout: 5000, timeoutMsg: "AT profile did not apply to the live session" },
    );

    // Enable hardware flow control: round-trips through the backend; the
    // already-visible signal block keeps live CTS/DSR status (mock port
    // reports asserted).
    await browser.execute(() => {
      const sel = document.querySelector(
        '.quick-panel [data-section="serial"] select[aria-label="Flow control"]',
      );
      sel.value = "hardware";
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await browser.waitUntil(
      () =>
        browser.execute(
          () =>
            document.querySelector('.quick-panel [data-section="serial"] .qp-line-val')
              ?.textContent === "asserted",
        ),
      { timeout: 5000, timeoutMsg: "CTS status never resolved" },
    );
    const signals = await browser.execute(() => {
      const sec = document.querySelector('.quick-panel [data-section="serial"]');
      return {
        text: sec.textContent,
        toggleLabels: [...sec.querySelectorAll(".qp-signals .qp-toggle-row")].map(
          (r) => r.textContent,
        ),
      };
    });
    expect(signals.toggleLabels).toEqual(["RTS", "DTR"]);
    expect(signals.text).toContain("CTS");
    expect(signals.text).toContain("DSR");

    // RTS toggle round-trips through the backend without error.
    await browser.execute(() => {
      const rows = [...document.querySelectorAll(".quick-panel .qp-signals .qp-toggle-row")];
      rows
        .find((r) => r.textContent.includes("RTS"))
        .querySelector(".qp-switch")
        .click();
    });

    // Auto-reconnect toggle persists in the backend.
    await browser.execute(() => {
      const rows = [
        ...document.querySelectorAll('.quick-panel [data-section="serial"] .qp-toggle-row'),
      ];
      rows
        .find((r) => r.textContent.includes("Auto-reconnect"))
        .querySelector(".qp-switch")
        .click();
    });
    const autoOn = await browser.executeAsync((done) => {
      (async () => {
        const mgr = window.__tterm.mgr;
        const id = mgr.activeTabId;
        const v = await window.__TAURI_INTERNALS__.invoke("session_get_auto_reconnect", { id });
        done(v === true);
      })();
    });
    expect(autoOn).toBe(true);

    // Manual release: Disconnect frees the port (dead mode, auto-reconnect
    // suppressed while held), Reconnect brings the session back.
    await browser.execute(() => {
      document.querySelector('.quick-panel [data-section="serial"] .qp-connect-btn').click();
    });
    await browser.waitUntil(
      () =>
        browser.execute(() => {
          const mgr = window.__tterm.mgr;
          return mgr.get(mgr.activeTabId)?.disconnected === true;
        }),
      { timeout: 8000, timeoutMsg: "disconnect did not dead the session" },
    );
    await browser.waitUntil(
      () =>
        browser.execute(
          () =>
            document.querySelector('.quick-panel [data-section="serial"] .qp-connect-btn')
              ?.textContent === "Reconnect",
        ),
      { timeout: 5000, timeoutMsg: "panel did not flip to Reconnect" },
    );
    await browser.execute(() => {
      document.querySelector('.quick-panel [data-section="serial"] .qp-connect-btn').click();
    });
    await browser.waitUntil(
      () =>
        browser.execute(() => {
          const mgr = window.__tterm.mgr;
          return mgr.get(mgr.activeTabId)?.disconnected === false;
        }),
      { timeout: 8000, timeoutMsg: "reconnect did not revive the session" },
    );

    // Baud select switches the live session and renames the tab.
    await browser.execute(() => {
      const sec = document.querySelector('.quick-panel [data-section="serial"]');
      const sel = [...sec.querySelectorAll("select")].find(
        (s) => s.getAttribute("aria-label") === "Baud rate",
      );
      sel.value = "9600";
      sel.dispatchEvent(new Event("change"));
    });
    await browser.waitUntil(
      async () => {
        return await browser.execute(() => {
          const mgr = window.__tterm.mgr;
          return mgr.get(mgr.activeTabId)?.serialBaud === 9600;
        });
      },
      { timeout: 5000, timeoutMsg: "baud switch did not apply" },
    );

    // Leave the window as we found it: close the serial tab and the panel.
    await browser.execute(() => document.getElementById("quick-status").click());
    await browser.executeAsync((done) => {
      (async () => {
        const mgr = window.__tterm.mgr;
        const serialIds = [...mgr.tabs.values()]
          .filter((t) => t.type === "serial")
          .map((t) => t.id);
        for (const id of serialIds) await mgr.closeTab(id);
        done(true);
      })();
    });
  });

  it("settings and terminals occlude the permanent welcome backdrop correctly", async () => {
    // The welcome watermark is a permanent backdrop: which LAYER is on top
    // is decided by DOM visibility + z-index, never by show/hide state.
    const visibleLayer = () =>
      browser.execute(() => {
        if (document.querySelector(".settings-page")) return "settings";
        const inst = [...document.querySelectorAll(".terminal-instance")].find(
          (el) => el.style.display !== "none",
        );
        return inst ? "terminal" : "welcome";
      });

    // Backdrop invariant: always rendered, always bottom layer.
    const backdrop = await browser.execute(() => {
      const cs = getComputedStyle(document.getElementById("welcome"));
      return { display: cs.display, zIndex: cs.zIndex, pointerEvents: cs.pointerEvents };
    });
    expect(backdrop.display).toBe("flex");
    expect(backdrop.zIndex).toBe("0");
    expect(backdrop.pointerEvents).toBe("none");

    await browser.execute(() => window.__tterm.mgr.toggleSettings());
    await browser.waitUntil(async () => (await visibleLayer()) === "settings", {
      timeout: 10000,
      timeoutMsg: "settings page did not open",
    });

    // Closing every terminal tab while settings is open: settings stays on
    // top (regression: welcome used to blank it).
    await browser.executeAsync((done) => {
      (async () => {
        const mgr = window.__tterm.mgr;
        for (const id of [...mgr.tabs.keys()]) await mgr.closeTab(id);
        done(true);
      })();
    });
    await browser.pause(400);
    expect(await visibleLayer()).toBe("settings");

    // Closing settings uncovers the backdrop; reopening covers it again —
    // the two pages must never stack.
    await browser.execute(() => window.__tterm.mgr.closeSettings(true));
    await browser.waitUntil(async () => (await visibleLayer()) === "welcome", {
      timeout: 5000,
      timeoutMsg: "welcome backdrop not uncovered after closing settings",
    });
    await browser.execute(() => window.__tterm.mgr.toggleSettings());
    await browser.waitUntil(async () => (await visibleLayer()) === "settings", {
      timeout: 10000,
      timeoutMsg: "settings page did not reopen over the backdrop",
    });
    await browser.execute(() => window.__tterm.mgr.closeSettings(true));
    await browser.waitUntil(async () => (await visibleLayer()) === "welcome", {
      timeout: 5000,
      timeoutMsg: "welcome backdrop not uncovered at the end",
    });
  });
});
