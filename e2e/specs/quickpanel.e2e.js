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
      const divider = document.querySelector(".win-divider");
      const qsRect = qs.getBoundingClientRect();
      const parkRect = park.getBoundingClientRect();
      const divRect = divider.getBoundingClientRect();
      const minRect = min.getBoundingClientRect();
      return {
        // Both buttons live in the shared group, quick-status first.
        grouped: group.contains(qs) && group.contains(park),
        order: qsRect.right <= parkRect.left,
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
      browser.execute(
        () => document.getElementById("quick-status").disabled
      );
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
    await browser.waitUntil(async () => {
      return await browser.execute(() => !!document.querySelector(".quick-panel .qp-share-url"));
    }, { timeout: 5000, timeoutMsg: "share URL row did not appear after toggle" });

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
    await browser.waitUntil(async () => {
      return await browser.execute(() => {
        const mgr = window.__tterm.mgr;
        return !mgr.get(mgr.activeTabId).shared;
      });
    }, { timeout: 5000 });

    await browser.execute(() => document.getElementById("quick-status").click()); // close
  });

  it("serial tab shows baud/newline selects, RTS toggle and CTS status", async () => {
    // Mock loopback port (debug builds inject it into serial_list_ports).
    await browser.executeAsync((done) => {
      (async () => {
        const mgr = window.__tterm.mgr;
        const tab = await mgr.createSerialTab({
          name: "MOCK-LOOP", driver: "tterm-mock", manufacturer: "TTerm",
          product: "Mock Loopback (echo)", vid: "", pid: "",
        });
        done(!!tab);
      })();
    });
    await browser.execute(() => document.getElementById("quick-status").click());
    const sec = await $('.quick-panel.open [data-section="serial"]');
    await sec.waitForExist({ timeout: 5000 });

    const info = await browser.execute(() => {
      const sec = document.querySelector('.quick-panel [data-section="serial"]');
      const selects = [...sec.querySelectorAll("select")].map((s) => s.getAttribute("aria-label"));
      return {
        selects,
        text: sec.textContent,
      };
    });
    expect(info.selects).toEqual(["Baud rate", "Output newlines", "Enter sends"]);
    expect(info.text).toContain("Auto-reconnect");
    expect(info.text).toContain("RTS line");
    expect(info.text).toContain("CTS line");

    // CTS is read live from the (mock) device: mocked ports report asserted.
    await browser.waitUntil(async () => {
      return await browser.execute(() =>
        document.querySelector('.quick-panel .qp-line-val')?.textContent === "asserted");
    }, { timeout: 5000, timeoutMsg: "CTS status never resolved" });

    // RTS toggle round-trips through the backend without error.
    await browser.execute(() => {
      const rows = [...document.querySelectorAll('.quick-panel [data-section="serial"] .qp-toggle-row')];
      rows.find((r) => r.textContent.includes("RTS line")).querySelector(".qp-switch").click();
    });

    // Auto-reconnect toggle persists in the backend.
    await browser.execute(() => {
      const rows = [...document.querySelectorAll('.quick-panel [data-section="serial"] .qp-toggle-row')];
      rows.find((r) => r.textContent.includes("Auto-reconnect")).querySelector(".qp-switch").click();
    });
    const autoOn = await browser.executeAsync((done) => {
      (async () => {
        const mgr = window.__tterm.mgr;
        const id = mgr.activeTabId;
        // Reach the backend through the same bridge the panel uses.
        const v = await window.__TAURI_INTERNALS__.invoke("session_get_auto_reconnect", { id });
        done(v === true);
      })();
    });
    expect(autoOn).toBe(true);

    // Baud select switches the live session and renames the tab.
    await browser.execute(() => {
      const sec = document.querySelector('.quick-panel [data-section="serial"]');
      const sel = [...sec.querySelectorAll("select")].find((s) => s.getAttribute("aria-label") === "Baud rate");
      sel.value = "9600";
      sel.dispatchEvent(new Event("change"));
    });
    await browser.waitUntil(async () => {
      return await browser.execute(() => {
        const mgr = window.__tterm.mgr;
        return mgr.get(mgr.activeTabId)?.serialBaud === 9600;
      });
    }, { timeout: 5000, timeoutMsg: "baud switch did not apply" });

    // Leave the window as we found it: close the serial tab and the panel.
    await browser.execute(() => document.getElementById("quick-status").click());
    await browser.executeAsync((done) => {
      (async () => {
        const mgr = window.__tterm.mgr;
        const serialIds = [...mgr.tabs.values()].filter((t) => t.type === "serial").map((t) => t.id);
        for (const id of serialIds) await mgr.closeTab(id);
        done(true);
      })();
    });
  });
});
