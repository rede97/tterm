#!/usr/bin/env bun
// Scene 3: serial + Profile AT + Share + Copy, then POST AT into that URL.
// No agent. Never closes an existing SSH tab. Next command waits for a new
// OK (CONNECT for AT+CONNECT); ERROR aborts.
//
//   bun run demo:share
//   bun run demo:share -- --url=<already-shared>

import {
  arg,
  bringTtermForward,
  click,
  connectCdp,
  countdown,
  hasFlag,
  hideCursor,
  makeLog,
  writeSystemClipboard,
} from "./inject.mjs";
import { cdpEnter, cdpType, listTargets, pickPage, sleep } from "./cdp.mjs";

const log = makeLog("share");

const AT_LINES = [
  "AT",
  "AT+GMR",
  'AT+CWJAP="TTerm-2.4G","rede97/tterm"',
  'AT+CIPSERVER="192.168.1.2",2323',
  "AT+CIPSERVER?",
  "AT+CONNECT",
];

const TIMINGS = {
  menuHold: 800,
  afterSerial: 2500,
  qpOpenHold: 1000,
  profileMenuHold: 1100,
  atHighlightHold: 700,
  afterAtPick: 900,
  afterShare: 800,
  afterCopy: 500,
  typeDelay: 45,
};

function shareEndpoint(shareUrl, leaf) {
  const u = new URL(shareUrl);
  u.pathname = `${u.pathname.replace(/\/$/, "")}/${leaf}`;
  return u;
}

async function fetchJson(url, { allow409 = false } = {}) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const res = await fetch(url);
    if (res.status === 429) {
      await sleep(250);
      continue;
    }
    if (allow409 && res.status === 409) {
      return { _conflict: true, ...(await res.json().catch(() => ({}))) };
    }
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`HTTP ${res.status} ${body}`.trim());
    }
    return res.json();
  }
  throw new Error(`rate limited: ${url}`);
}

async function getScreen(shareUrl, waitSeq, timeoutSec) {
  const u = shareEndpoint(shareUrl, "screen");
  if (waitSeq !== undefined) {
    u.searchParams.set("wait", String(waitSeq));
    u.searchParams.set("timeout", String(timeoutSec ?? 25));
  }
  return fetchJson(u.toString());
}

// Fresh serial viewport is already `rows` empty lines, so /lines?since=
// stays empty (total never grows). New OK is only on /screen, often after
// two blank rows: ["AT","","","OK"].
function tokensOf(lines) {
  const out = [];
  for (const raw of lines ?? []) {
    const t = String(raw).trim();
    if (/^ERROR$/i.test(t)) out.push("error");
    else if (/^OK$/i.test(t)) out.push("ok");
    else if (/^CONNECT$/i.test(t)) out.push("connect");
  }
  return out;
}

function acceptFor(cmd) {
  return cmd === "AT+CONNECT" ? new Set(["ok", "connect"]) : new Set(["ok"]);
}

function waitBudgetMs(cmd) {
  if (cmd.startsWith("AT+CWJAP")) return 15000;
  return 8000;
}

function tailNonempty(lines, n = 8) {
  return (lines ?? []).map((l) => String(l).trim()).filter(Boolean).slice(-n);
}

async function waitNewReply(shareUrl, beforeLines, cmd) {
  const accept = acceptFor(cmd);
  const timeoutMs = waitBudgetMs(cmd);
  const beforeN = tokensOf(beforeLines).length;
  const deadline = Date.now() + timeoutMs;
  let lastLines = beforeLines ?? [];

  // Do not long-poll wait=<frontend seq>. share_screen_changed is throttled
  // 200ms and the hub seq lags; waiting for hub > snap.seq parks until the
  // 8s timeout even after OK is already on screen. wait=0 + short sleep
  // skips the 1/s plain-poll limit and returns the current snapshot.
  while (Date.now() < deadline) {
    const snap = await getScreen(shareUrl, 0, 1);
    lastLines = snap.lines ?? [];
    const toks = tokensOf(lastLines);
    if (toks.length <= beforeN) {
      await sleep(40);
      continue;
    }
    const neu = toks.slice(beforeN);
    if (neu.includes("error")) {
      throw new Error(`${cmd} → ERROR\n${tailNonempty(lastLines).join("\n")}`);
    }
    const hit = neu.find((t) => accept.has(t));
    if (hit) {
      log(`${cmd} → ${hit.toUpperCase()}`);
      return snap;
    }
    throw new Error(
      `${cmd} → ${neu[neu.length - 1].toUpperCase()} (wanted ${[...accept].join("/").toUpperCase()})`,
    );
  }

  const want = [...accept].join("/").toUpperCase();
  const tail = tailNonempty(lastLines).join("\n");
  throw new Error(`${cmd} timed out waiting for ${want} (${timeoutMs}ms)${tail ? `\n${tail}` : ""}`);
}

async function sendAtViaShare(shareUrl, lines = AT_LINES) {
  const inputUrl = shareEndpoint(shareUrl, "input").toString();
  let snap = await getScreen(shareUrl, 0, 1);
  for (const text of lines) {
    log(`POST ${text}`);
    const res = await fetch(inputUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: `${text}\r\n` }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`/input HTTP ${res.status} ${body}`.trim());
    }
    snap = await waitNewReply(shareUrl, snap.lines, text);
  }
}

async function focusSerialTerminal(cdp) {
  await cdp.evaluate(() => {
    const vis = [...document.querySelectorAll(".terminal-instance")].find(
      (el) => el instanceof HTMLElement && el.style.display !== "none",
    );
    const ta = vis?.querySelector(".xterm-helper-textarea");
    if (!(ta instanceof HTMLTextAreaElement)) throw new Error("serial terminal textarea missing");
    ta.focus();
  });
  await sleep(150);
}

async function sendAtViaTerminal(cdp, shareUrl, lines = AT_LINES) {
  await focusSerialTerminal(cdp);
  let snap = await getScreen(shareUrl, 0, 1);
  for (const text of lines) {
    log(`type ${text}`);
    await cdpType(cdp, text, TIMINGS.typeDelay);
    await cdpEnter(cdp);
    snap = await waitNewReply(shareUrl, snap.lines, text);
  }
}

async function probe() {
  const port = Number(arg("cdp", process.env.TTERM_DEMO_CDP ?? "9222"));
  const targets = await listTargets(port);
  console.log(JSON.stringify(targets, null, 2));
  const page = pickPage(targets);
  if (!page) {
    log("no page target");
    process.exit(1);
  }
  log(`page ${page.title} ${page.url}`);
}

async function openSerial(cdp) {
  await click(cdp, "#new-tab-menu-btn");
  await cdp.waitFor(
    () => Boolean(document.querySelector("#profile-menu.open")),
    4000,
    "profile menu did not open",
  );
  await sleep(TIMINGS.menuHold);
  const label = await cdp.evaluate(() => {
    const cols = [...document.querySelectorAll("#profile-menu .profile-col")];
    const serialCol = cols.find((col) => {
      const title = col.querySelector(".profile-section-title");
      return (title?.textContent ?? "").trim() === "Serial";
    });
    const hit = serialCol?.querySelector(".profile-item");
    if (!(hit instanceof HTMLElement)) {
      throw new Error("Serial column empty — no port to open");
    }
    hit.click();
    return (hit.textContent ?? "").trim();
  });
  log(`opened ${label}`);
  await cdp.waitFor(
    () => !document.querySelector("#profile-menu.open"),
    4000,
    "profile menu stayed open",
  );
  await sleep(TIMINGS.afterSerial);
}

async function qpProfileAt(cdp) {
  await cdp.waitFor(
    () => /COM\d+/i.test(document.querySelector("#tabs .tab.active")?.textContent ?? ""),
    8000,
    "serial tab did not become active",
  );
  await click(cdp, "#quick-status");
  await cdp.waitFor(
    () =>
      [...document.querySelectorAll(".quick-panel.open .qp-label")].some(
        (el) => (el.textContent ?? "").trim() === "Profile",
      ),
    6000,
    "QP has no Profile row (serial panel not up)",
  );
  await sleep(TIMINGS.qpOpenHold);
  await cdp.evaluate(() => {
    const row = [...document.querySelectorAll(".quick-panel .qp-row")].find(
      (el) => (el.querySelector(".qp-label")?.textContent ?? "").trim() === "Profile",
    );
    const trigger = row?.querySelector(".tt-select-trigger");
    if (!(trigger instanceof HTMLElement)) throw new Error("QP Profile trigger missing");
    trigger.click();
  });
  await cdp.waitFor(
    () => Boolean(document.querySelector("body > .tt-select-menu .tt-option")),
    4000,
    "Profile menu did not portal",
  );
  await sleep(TIMINGS.profileMenuHold);
  await cdp.evaluate(() => {
    const opts = [...document.querySelectorAll("body > .tt-select-menu .tt-option")];
    for (const o of opts) o.classList.remove("active");
    const opt = opts.find(
      (el) => (el.getAttribute("data-value") ?? "") === "AT" || (el.textContent ?? "").trim() === "AT",
    );
    if (!(opt instanceof HTMLElement)) throw new Error("AT option missing");
    opt.classList.add("active");
    opt.scrollIntoView({ block: "nearest" });
  });
  await sleep(TIMINGS.atHighlightHold);
  await cdp.evaluate(() => {
    const opt = [...document.querySelectorAll("body > .tt-select-menu .tt-option")].find(
      (el) =>
        el.classList.contains("active") &&
        ((el.getAttribute("data-value") ?? "") === "AT" || (el.textContent ?? "").trim() === "AT"),
    );
    if (!(opt instanceof HTMLElement)) throw new Error("AT option missing");
    opt.click();
  });
  await cdp.waitFor(
    () => {
      const row = [...document.querySelectorAll(".quick-panel .qp-row")].find(
        (el) => (el.querySelector(".qp-label")?.textContent ?? "").trim() === "Profile",
      );
      const t = (row?.querySelector(".tt-select-trigger")?.textContent ?? "").trim();
      return t === "AT" ? "AT" : "";
    },
    4000,
    "Profile trigger did not show AT",
  );
  await sleep(TIMINGS.afterAtPick);
}

async function shareActive(cdp) {
  await cdp.evaluate(() => {
    const row = [...document.querySelectorAll(".quick-panel .qp-row")].find((el) =>
      /share this session/i.test(el.textContent ?? ""),
    );
    const sw = row?.querySelector("button, [role=switch], .tt-switch");
    if (!(sw instanceof HTMLElement)) throw new Error("Share this session toggle missing");
    const on = sw.getAttribute("aria-checked") === "true" || sw.classList.contains("on");
    if (!on) sw.click();
  });
  await sleep(TIMINGS.afterShare);
  const url = await waitShareUrl(cdp);
  await cdp.evaluate(() => {
    const btn = document.querySelector(".qp-share-url-row .tt-btn");
    if (!(btn instanceof HTMLButtonElement)) throw new Error("Copy button missing");
    btn.click();
  });
  await sleep(TIMINGS.afterCopy);
  writeSystemClipboard(url);
  log("system clipboard holds share URL");
  return url;
}

async function closeQuickPanel(cdp) {
  if (
    !(await cdp.evaluate(() => Boolean(document.querySelector(".quick-panel.open"))))
  ) {
    return;
  }
  await click(cdp, "#quick-status");
  await cdp.waitFor(
    () => !document.querySelector(".quick-panel.open"),
    4000,
    "Quick Panel stayed open",
  );
  await sleep(300);
}

async function waitShareUrl(cdp) {
  return cdp.waitFor(
    () => {
      const el = document.querySelector(".qp-share-url");
      const t = (el?.getAttribute("title") || el?.textContent || "").trim();
      return t.startsWith("http") ? t : "";
    },
    4000,
    "share URL missing after toggle",
  );
}

async function injectAt(url, cdp) {
  if (cdp) {
    log("type AT into serial tab (line echo + CRLF)");
    await sendAtViaTerminal(cdp, url);
    return;
  }
  log("POST AT into share /input (no agent, CRLF)");
  await sendAtViaShare(url);
}

async function main() {
  if (hasFlag("probe")) {
    await probe();
    return;
  }

  const given = arg("url", process.env.TTERM_SHARE_URL ?? "");
  if (given) {
    log("using --url (SSH tabs untouched)");
    writeSystemClipboard(given);
    log("system clipboard holds share URL");
    await injectAt(given);
    log("done");
    return;
  }

  const port = Number(arg("cdp", process.env.TTERM_DEMO_CDP ?? "9222"));
  const count = Number(arg("countdown", "3"));
  const cdp = await connectCdp(port, log);
  if (count > 0) await countdown(count, log);

  try {
    await hideCursor(cdp);
    bringTtermForward(log);
    await sleep(200);

    log("open Serial (leave SSH tabs)");
    await openSerial(cdp);

    log("QP Profile = AT + Share");
    await qpProfileAt(cdp);
    const url = await shareActive(cdp);
    await closeQuickPanel(cdp);
    await injectAt(url, cdp);
    log("done — SSH tabs still open");
  } finally {
    cdp.close();
  }
}

main().catch((err) => {
  console.error(`[share] ${err.message}`);
  if (/fetch|ECONNREFUSED|not reachable|CDP/i.test(String(err))) {
    console.error(
      "[share] Start TTerm with WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 --remote-allow-origins=*",
    );
  }
  process.exit(1);
});
