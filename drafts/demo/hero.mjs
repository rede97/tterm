#!/usr/bin/env bun
// Scene 1 / hero.gif injector. Attaches to a running TTerm WebView2 (CDP).
// Does not spawn the app, does not use window.__tterm.
//
// Launch TTerm with:
//   WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 --remote-allow-origins=*
// Arrange Settings + ras/btop, start OBS, then:
//   bun run demo:hero

import { spawnSync } from "node:child_process";
import {
  cdpEnter,
  cdpTab,
  cdpType,
  fireCombo,
  fireKeyOn,
  listTargets,
  openSession,
  pickPage,
  sleep,
  waitForPage,
} from "./cdp.mjs";

// -- knobs (edit here) --

const TIMINGS = {
  settingsHold: 1000,
  typeDelay: 70,
  palListHold: 500,
  btopHold: 2000,
  palCmdHold: 400,
  hostListHold: 500,
  sshSettle: 1200,
  nyanTypeDelay: 90,
  nyanHold: 2000, // after nyancat Enter, before QP
  qpHold: 600,
  afterPort: 200,
  afterAdd: 1000,
};

const QUERIES = {
  ras: "ras",
  newSsh: "new ssh tab",
  ubuntu: "ubuntu",
  nyan: "nyancat",
  listenPort: "8000",
  targetPort: "8000",
};

const LISTEN_SEL =
  '.quick-panel .ft-group:has(.ft-g-remote) .ft-add-row input[aria-label="Listen port"]';
const HOST_SEL =
  '.quick-panel .ft-group:has(.ft-g-remote) .ft-add-row input[aria-label="Target host"]';
const PORT_SEL =
  '.quick-panel .ft-group:has(.ft-g-remote) .ft-add-row input[aria-label="Target port"]';
const ADD_SEL = ".quick-panel .ft-group:has(.ft-g-remote) .ft-add-row .ft-add";

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!hit) return fallback;
  return hit.slice(name.length + 3);
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

const CDP_PORT = Number(arg("cdp", process.env.TTERM_DEMO_CDP ?? "9222"));
const COUNTDOWN = Number(arg("countdown", "3"));

function log(msg) {
  console.log(`[hero] ${msg}`);
}

function bringTtermForward() {
  if (process.platform !== "win32") return;
  const ps = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class Native {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);
}
"@
$h = [Native]::FindWindow($null, "TTerm")
if ($h -eq [IntPtr]::Zero) { Write-Output "not-found"; exit 0 }
[Native]::ShowWindow($h, 9) | Out-Null
[Native]::SetForegroundWindow($h) | Out-Null
Write-Output "ok"
`;
  const r = spawnSync("powershell", ["-NoProfile", "-Command", ps], {
    encoding: "utf8",
  });
  if (r.stdout?.includes("not-found")) {
    log("warning: FindWindow TTerm missed (still injecting via CDP)");
  }
}

async function hideCursor(cdp) {
  await cdp.evaluate(() => {
    if (document.getElementById("tt-demo-hide-cursor")) return;
    document.documentElement.classList.add("tt-demo-hide-cursor");
    const s = document.createElement("style");
    s.id = "tt-demo-hide-cursor";
    s.textContent =
      "html.tt-demo-hide-cursor, html.tt-demo-hide-cursor * { cursor: none !important; }";
    document.head.appendChild(s);
  });
}

async function typeInto(cdp, selector, text, delayMs) {
  await cdp.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!(el instanceof HTMLInputElement)) throw new Error(`missing ${sel}`);
    el.focus();
    el.value = "";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, selector);
  let acc = "";
  for (const ch of text) {
    acc += ch;
    await cdp.evaluate(
      (sel, v) => {
        const el = document.querySelector(sel);
        if (!(el instanceof HTMLInputElement)) throw new Error(`missing ${sel}`);
        el.focus();
        el.value = v;
        el.dispatchEvent(new Event("input", { bubbles: true }));
      },
      selector,
      acc,
    );
    await sleep(delayMs);
  }
}

async function click(cdp, selector) {
  await cdp.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error(`missing ${sel}`);
    el.click();
  }, selector);
}

async function focusedIs(cdp, selector) {
  return cdp.evaluate((sel) => document.activeElement === document.querySelector(sel), selector);
}

async function focusSel(cdp, selector) {
  await cdp.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!(el instanceof HTMLElement)) throw new Error(`missing ${sel}`);
    el.focus();
  }, selector);
}

async function fillRemoteForward(cdp) {
  await cdp.waitFor(
    () => Boolean(document.querySelector(".quick-panel .ft-g-remote")),
    4000,
    "Remote (-R) group not in Quick Panel (need embedded SSH)",
  );
  await cdp.evaluate(() => {
    const title = [...document.querySelectorAll(".quick-panel .ft-group-title")].find((el) =>
      el.classList.contains("ft-g-remote"),
    );
    title?.closest(".ft-group")?.querySelector(".ft-add-row")?.scrollIntoView({
      block: "nearest",
    });
  });

  await typeInto(cdp, LISTEN_SEL, QUERIES.listenPort, TIMINGS.typeDelay);
  await sleep(TIMINGS.afterPort);

  await cdpTab(cdp);
  if (!(await focusedIs(cdp, HOST_SEL))) await focusSel(cdp, HOST_SEL);
  await cdpTab(cdp);
  if (!(await focusedIs(cdp, PORT_SEL))) await focusSel(cdp, PORT_SEL);

  await typeInto(cdp, PORT_SEL, QUERIES.targetPort, TIMINGS.typeDelay);
  await sleep(TIMINGS.afterPort);
  await click(cdp, ADD_SEL);
  await sleep(TIMINGS.afterAdd);
}

async function probe() {
  const targets = await listTargets(CDP_PORT);
  console.log(JSON.stringify(targets, null, 2));
  const page = pickPage(targets);
  if (!page) {
    log("no page target");
    process.exit(1);
  }
  log(`page ${page.title} ${page.url}`);
}

async function countdown() {
  for (let n = COUNTDOWN; n > 0; n--) {
    log(`record in ${n}…`);
    await sleep(1000);
  }
}

async function main() {
  if (hasFlag("probe")) {
    await probe();
    return;
  }

  log(`connecting CDP :${CDP_PORT}`);
  const { page } = await waitForPage(CDP_PORT, 8000);
  log(`attached ${page.title} ${page.url}`);
  const cdp = await openSession(page.webSocketDebuggerUrl);

  if (COUNTDOWN > 0) await countdown();

  try {
    await hideCursor(cdp);
    bringTtermForward();
    await sleep(200);

    log("幕1 Settings hold");
    await sleep(TIMINGS.settingsHold);

    log("幕2 Ctrl+P ras");
    await fireCombo(cdp, "ctrl+p");
    await cdp.waitFor(
      () => Boolean(document.querySelector(".pal-overlay .pal-input")),
      4000,
      "Ctrl+P overlay did not open",
    );
    await typeInto(cdp, ".pal-overlay .pal-input", QUERIES.ras, TIMINGS.typeDelay);
    await sleep(TIMINGS.palListHold);
    await fireKeyOn(cdp, ".pal-overlay .pal-input", "Enter", "Enter");
    await cdp.waitFor(() => !document.querySelector(".pal-overlay"), 4000, "Go to Tab did not close");

    log("幕3 btop hold");
    await sleep(TIMINGS.btopHold);

    log("幕4 Ctrl+Shift+P New SSH Tab → ubuntu");
    await fireCombo(cdp, "ctrl+shift+p");
    await cdp.waitFor(
      () => Boolean(document.querySelector(".pal-prefix.on") && document.querySelector(".pal-input")),
      4000,
      "command palette did not open",
    );
    await typeInto(cdp, ".pal-panel .pal-input", QUERIES.newSsh, TIMINGS.typeDelay);
    await sleep(TIMINGS.palCmdHold);
    await fireKeyOn(cdp, ".pal-panel .pal-input", "Enter", "Enter");
    await cdp.waitFor(
      () => Boolean(document.querySelector(".pal-panel .pal-input") && !document.querySelector(".pal-prefix.on")),
      4000,
      "SSH hosts page did not open",
    );
    await typeInto(cdp, ".pal-panel .pal-input", QUERIES.ubuntu, TIMINGS.typeDelay);
    await sleep(TIMINGS.hostListHold);
    await fireKeyOn(cdp, ".pal-panel .pal-input", "Enter", "Enter");
    await cdp.waitFor(
      () => !document.querySelector(".pal-overlay"),
      8000,
      "New SSH Tab did not close after connect",
    );
    await sleep(TIMINGS.sshSettle);

    log("幕5 nyancat");
    await cdp.evaluate(() => {
      const ta = document.querySelector(".xterm-helper-textarea");
      if (ta instanceof HTMLTextAreaElement) ta.focus();
    });
    await sleep(150);
    await cdpType(cdp, QUERIES.nyan, TIMINGS.nyanTypeDelay);
    await cdpEnter(cdp);
    await sleep(TIMINGS.nyanHold);

    log("幕6 Quick Panel Remote 8000");
    await click(cdp, "#quick-status");
    await cdp.waitFor(
      () => Boolean(document.querySelector(".quick-panel.open")),
      4000,
      "Quick Panel did not open",
    );
    await sleep(TIMINGS.qpHold);
    await fillRemoteForward(cdp);
    log("done — leave OBS rolling on the new Remote row");
  } finally {
    cdp.close();
  }
}

main().catch((err) => {
  console.error(`[hero] ${err.message}`);
  if (/fetch|ECONNREFUSED|not reachable|CDP|Unable to connect|Failed to parse URL/i.test(String(err))) {
    console.error(
      "[hero] Start TTerm with WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 --remote-allow-origins=*",
    );
  }
  process.exit(1);
});
