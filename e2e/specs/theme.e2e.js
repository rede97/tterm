// Custom themes + theme-background continuity.
//
// 1. The .terminal-instance container must always match the active theme's
//    background — xterm only paints whole cells, so edge strips would
//    otherwise show a mismatched color ("visual seam").
// 2. Duplicating a builtin theme creates an editable custom copy, shown in
//    the gallery's separate Custom section (persisted in themes.json,
//    not config.json).

async function containerBg() {
  return browser.execute(() => {
    const mgr = window.__tterm.mgr;
    const tab = mgr.get(mgr.activeTabId);
    if (!tab) return null;
    return getComputedStyle(tab.element).backgroundColor;
  });
}

// The chrome surrounding xterm: active tab + the container holding it.
// Both must track the theme background or resize/edge strips show a seam.
async function chromeBgs() {
  return browser.execute(() => ({
    activeTab: getComputedStyle(document.querySelector("#tabs .tab.active")).backgroundColor,
    container: getComputedStyle(document.getElementById("terminal-container")).backgroundColor,
    body: getComputedStyle(document.body).backgroundColor,
  }));
}

async function openAppearanceSettings() {
  // #settings-btn toggles — only click when the settings page isn't open.
  const isOpen = await browser.execute(() => {
    const page = document.querySelector(".settings-page");
    return !!page && page.offsetParent !== null;
  });
  if (!isOpen) await $("#settings-btn").click();
  const nav = await $('.settings-nav-item[data-panel="appearance"]');
  await nav.waitForExist({ timeout: 10000 });
  await nav.click();
}

async function clickApply() {
  const applied = await browser.execute(() => {
    const btn = [...document.querySelectorAll(".settings-btn")].find(
      (b) => b.textContent === "Apply",
    );
    if (btn) btn.click();
    return !!btn;
  });
  expect(applied).toBe(true);
  await browser.pause(300);
}

async function selectThemeCard(name) {
  const found = await browser.execute((n) => {
    const card = [...document.querySelectorAll("#set-theme-gallery .theme-card")].find(
      (c) => c.dataset.theme === n,
    );
    if (card) card.click();
    return !!card;
  }, name);
  expect(found).toBe(true);
}

describe("custom themes", () => {
  // Whatever happens, restore the default theme and remove the test theme.
  after(async () => {
    try {
      await openAppearanceSettings();
      await selectThemeCard("TTerm Dark");
      await clickApply();
      await browser.execute(() => {
        const card = [...document.querySelectorAll("#set-theme-gallery .theme-card")].find(
          (c) => c.dataset.theme === "E2E Custom",
        );
        if (card) {
          [...card.querySelectorAll(".theme-card-action")]
            .find((b) => b.textContent === "Edit")
            .click();
          // te-delete opens a confirmDialog — the cleanup must also click
          // its OK button or the theme is never actually deleted (leftover
          // then collides with the next run's duplicate-and-save).
          setTimeout(() => {
            document.querySelector(".te-delete")?.click();
            setTimeout(() => {
              document
                .querySelector(".confirm-overlay .sshauth-footer .sshauth-btn:last-child")
                ?.click();
            }, 200);
          }, 200);
        }
      });
      await browser.pause(500);
      await browser.execute(() => {
        const mgr = window.__tterm.mgr;
        if (document.querySelector('[data-tab-id="#settings"]')) mgr.closeSettings(true);
      });
      // biome-ignore lint/plugin: best-effort test cleanup — failure must not mask the suite result
    } catch {
      /* best-effort cleanup */
    }
  });

  it("container background follows the theme; duplicate creates an editable copy in the Custom section", async () => {
    await $("#tab-bar").waitForExist({ timeout: 20000 });
    await browser.waitUntil(async () => (await $$("#tabs .tab")).length >= 1, {
      timeout: 20000,
      timeoutMsg: "initial tab did not appear",
    });
    await browser.pause(800);

    // Normalize: the persisted user config may have any theme active.
    await openAppearanceSettings();
    await selectThemeCard("TTerm Dark");
    await clickApply();

    // Default theme TTerm Dark: #1e1e1e.
    await browser.waitUntil(async () => (await containerBg()) === "rgb(30, 30, 30)", {
      timeout: 5000,
      timeoutMsg: "container background did not match TTerm Dark",
    });
    await selectThemeCard("Solarized Light");
    await clickApply();
    await browser.waitUntil(async () => (await containerBg()) === "rgb(253, 246, 227)", {
      timeout: 5000,
      timeoutMsg: "container background did not follow the light theme",
    });

    // Terminal area follows the theme; tab chrome stays dark (a white tab
    // title on a light tab would be unreadable). Active tab is one step
    // LIGHTER than the bar (#2d2d2d + top highlight) since the redesign.
    const chrome = await chromeBgs();
    expect(chrome.activeTab).toBe("rgb(45, 45, 45)"); // stays #2d2d2d
    expect(chrome.container).toBe("rgb(253, 246, 227)");
    expect(chrome.body).toBe("rgb(253, 246, 227)");
    const settingsPadding = await browser.execute(
      () => getComputedStyle(document.getElementById("terminal-container")).padding,
    );
    // Settings overlays the pane like the welcome backdrop — the 2px gutter
    // stays (zeroing it via :has regressed the fit; see styles.css note).
    expect(settingsPadding).toBe("2px");

    // Gallery is split into Built-in / Custom sections.
    const groupTitles = await browser.execute(() =>
      [...document.querySelectorAll("#set-theme-gallery .theme-group-title")].map(
        (el) => el.textContent,
      ),
    );
    expect(groupTitles).toEqual(["Built-in", "Custom"]);

    // Duplicate Solarized Light into a custom copy.
    await browser.execute(() => {
      const card = [...document.querySelectorAll("#set-theme-gallery .theme-card")].find(
        (c) => c.dataset.theme === "Solarized Light",
      );
      card.querySelector(".theme-card-action").click(); // Duplicate
    });
    await $(".te-overlay").waitForExist({ timeout: 5000 });
    await browser.execute(() => {
      document.querySelector(".te-name").value = "E2E Custom";
      // Change the background to prove colors save.
      const hex = document.querySelector('.te-hex[data-key="background"]');
      hex.value = "#123456";
      hex.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await $(".te-save").click();
    await browser.waitUntil(
      async () => browser.execute(() => !document.querySelector(".te-overlay")),
      { timeout: 5000, timeoutMsg: "editor did not close after save" },
    );

    // The custom theme shows in the Custom section with an Edit action.
    const customCard = await browser.execute(() => {
      const card = [...document.querySelectorAll("#set-theme-gallery .theme-card")].find(
        (c) => c.dataset.theme === "E2E Custom",
      );
      if (!card) return null;
      return {
        actions: [...card.querySelectorAll(".theme-card-action")].map((b) => b.textContent),
        bg: card.querySelector(".theme-card-preview").style.background,
        section: (() => {
          let el = card.closest(".theme-grid");
          while (el && !el.previousElementSibling?.classList?.contains("theme-group-title")) {
            el = el.previousElementSibling;
          }
          return el?.previousElementSibling?.textContent ?? null;
        })(),
      };
    });
    expect(customCard).not.toBeNull();
    expect(customCard.actions).toContain("Edit");
    expect(customCard.bg).toBe("rgb(18, 52, 86)"); // #123456
    expect(customCard.section).toBe("Custom");

    // Select it and Apply — container must follow the custom background.
    await selectThemeCard("E2E Custom");
    await clickApply();
    await browser.waitUntil(async () => (await containerBg()) === "rgb(18, 52, 86)", {
      timeout: 5000,
      timeoutMsg: "container background did not follow the custom theme",
    });

    // Cleanup: restore default theme, delete the custom theme.
    await selectThemeCard("TTerm Dark");
    await clickApply();
    await browser.execute(() => {
      const card = [...document.querySelectorAll("#set-theme-gallery .theme-card")].find(
        (c) => c.dataset.theme === "E2E Custom",
      );
      [...card.querySelectorAll(".theme-card-action")]
        .find((b) => b.textContent === "Edit")
        .click();
    });
    await $(".te-overlay").waitForExist({ timeout: 5000 });
    await $(".te-delete").click();
    // te-delete opens the app's confirmDialog (custom modal, not native
    // confirm) — approve the deletion.
    await browser.waitUntil(async () => await $(".confirm-overlay").isExisting(), {
      timeout: 3000,
      timeoutMsg: "delete confirmation did not appear",
    });
    await browser.execute(() => {
      document.querySelector(".confirm-overlay .sshauth-footer .sshauth-btn:last-child")?.click();
    });
    await browser.waitUntil(
      async () =>
        browser.execute(
          () =>
            ![...document.querySelectorAll("#set-theme-gallery .theme-card")].some(
              (c) => c.dataset.theme === "E2E Custom",
            ),
        ),
      { timeout: 5000, timeoutMsg: "custom theme was not deleted" },
    );

    // Close settings back to the terminal; the 2px theme-colored frame
    // around the terminal returns.
    await browser.execute(() => window.__tterm.mgr.closeSettings(true));
    await browser.pause(200);
    const paddingAfter = await browser.execute(
      () => getComputedStyle(document.getElementById("terminal-container")).padding,
    );
    expect(paddingAfter).toBe("2px");
  });
});
