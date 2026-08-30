#!/usr/bin/env bun
// Scene 2 / agent.gif injector. CDP for the font picker; uv/Python SendInput
// for 中文输入法. Does not use window.__tterm.
//
// Same WebView2 CDP launch as hero. Arrange: Settings → Appearance (picker
// closed), NF not yet in the fallback chain, local Agent tab running Working.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cdpDrag, cdpEnter, fireCombo, listTargets, pickPage, sleep } from "./cdp.mjs";
import {
  arg,
  bringTtermForward,
  click,
  connectCdp,
  countdown,
  hasFlag,
  hideCursor,
  makeLog,
  typeInto,
} from "./inject.mjs";

const DIR = dirname(fileURLToPath(import.meta.url));
const log = makeLog("agent");

const TIMINGS = {
  typeDelay: 70,
  afterOpenPicker: 300,
  afterSearch: 400,
  afterAdd: 400,
  scrollMs: 1000,
  dragMs: 1000,
  afterDrag: 500,
  afterApply: 400,
  palListHold: 400,
  workingHold: 1000,
};

const QUERIES = {
  fontSearch: "jet",
  nfFamilyRe: "nerd|\\bnf\\b",
  preferFamilyRe: "jetbrains",
  gotoTab: "pi",
};

function pythonExe() {
  const win = join(DIR, ".venv", "Scripts", "python.exe");
  const nix = join(DIR, ".venv", "bin", "python");
  if (existsSync(win)) return win;
  if (existsSync(nix)) return nix;
  return null;
}

async function pickSystemNf(cdp) {
  return cdp.evaluate((nfRe, preferRe) => {
    const nf = new RegExp(nfRe, "i");
    const prefer = new RegExp(preferRe, "i");
    const rows = [...document.querySelectorAll("#fp-system .fp-font-item")];
    const open = rows.filter((r) => {
      const fam = r.dataset.family ?? "";
      const add = r.querySelector(".fp-font-add");
      if (add?.classList.contains("in-use")) return false;
      return nf.test(fam);
    });
    const jet = open.find((r) => prefer.test(r.dataset.family ?? ""));
    const hit = jet ?? open[0];
    if (!hit) {
      const seen = rows.map((r) => r.dataset.family).filter(Boolean);
      throw new Error(`no unused System NF matching /${nfRe}/ (saw: ${seen.slice(0, 12).join(", ")})`);
    }
    return hit.dataset.family;
  }, QUERIES.nfFamilyRe, QUERIES.preferFamilyRe);
}

async function addSystemFamily(cdp, family) {
  await cdp.evaluate((fam) => {
    const row = [...document.querySelectorAll("#fp-system .fp-font-item")].find(
      (r) => (r.dataset.family ?? "").toLowerCase() === fam.toLowerCase(),
    );
    const add = row?.querySelector(".fp-font-add");
    if (!(add instanceof HTMLButtonElement)) throw new Error(`no + for ${fam}`);
    if (add.classList.contains("in-use")) throw new Error(`${fam} already in chain`);
    row.scrollIntoView({ block: "nearest" });
    add.click();
  }, family);
}

async function chainFamilies(cdp) {
  return cdp.evaluate(() =>
    [...document.querySelectorAll("#fp-selected .fp-selected-item")].map((el) => el.dataset.family),
  );
}

/** Jump the picker preview xterm to the last line (Nerd Font glyphs). */
async function scrollPreviewToBottom(cdp) {
  await cdp.waitFor(
    () => Boolean(document.querySelector("#fp-preview .xterm-viewport")),
    2000,
    "font preview viewport missing",
  );
  await cdp.evaluate(() => {
    const vp = document.querySelector("#fp-preview .xterm-viewport");
    if (!(vp instanceof HTMLElement)) throw new Error("font preview viewport missing");
    vp.scrollTop = vp.scrollHeight;
  });
}

/** Scroll the picker body so the newly appended fallback row is on screen. */
async function scrollChainToBottom(cdp, family) {
  const plan = await cdp.evaluate((fam) => {
    const body = document.querySelector(".font-picker-body");
    const list = document.getElementById("fp-selected");
    if (!(body instanceof HTMLElement) || !list) throw new Error("picker body/list missing");
    const row = [...list.children].find(
      (el) =>
        el instanceof HTMLElement && (el.dataset.family ?? "").toLowerCase() === fam.toLowerCase(),
    );
    if (!(row instanceof HTMLElement)) throw new Error(`${fam} not in chain`);
    return {
      start: body.scrollTop,
      max: Math.max(0, body.scrollHeight - body.clientHeight),
    };
  }, family);
  const steps = 20;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    await cdp.evaluate(
      (start, max, frac) => {
        const body = document.querySelector(".font-picker-body");
        if (body instanceof HTMLElement) body.scrollTop = start + (max - start) * frac;
      },
      plan.start,
      plan.max,
      t,
    );
    await sleep(TIMINGS.scrollMs / steps);
  }
}

async function dragAddedUp(cdp) {
  const fams = await chainFamilies(cdp);
  if (!fams?.length) throw new Error("fallback chain empty after add");
  const last = fams.length - 1;
  if (last === 0) return;
  const geo = await cdp.evaluate(() => {
    const body = document.querySelector(".font-picker-body");
    const list = document.getElementById("fp-selected");
    const items = [...document.querySelectorAll("#fp-selected .fp-selected-item")];
    if (!(body instanceof HTMLElement) || !list || items.length < 2) return null;
    const br = body.getBoundingClientRect();
    const lr = list.getBoundingClientRect();
    // Stay inside the visible chain, away from the body clip (Sortable /
    // Chromium edge-scroll would yank Search back into view).
    const clip = {
      l: Math.max(br.left, lr.left) + 12,
      r: Math.min(br.right, lr.right) - 12,
      t: Math.max(br.top, lr.top) + 28,
      b: Math.min(br.bottom, lr.bottom) - 12,
    };
    const lastEl = items[items.length - 1];
    const lastGrip = lastEl.querySelector(".fp-drag-grip") ?? lastEl;
    const g = lastGrip.getBoundingClientRect();
    const clamp = (x, y) => ({
      x: Math.round(Math.min(clip.r, Math.max(clip.l, x))),
      y: Math.round(Math.min(clip.b, Math.max(clip.t, y))),
    });
    return {
      freeze: body.scrollTop,
      from: clamp((g.left + g.right) / 2, (g.top + g.bottom) / 2),
      to: clamp((g.left + g.right) / 2, clip.t),
    };
  });
  if (!geo) throw new Error("could not measure fallback rows");
  await cdp.evaluate((y) => {
    const body = document.querySelector(".font-picker-body");
    if (!(body instanceof HTMLElement)) return;
    const prev = window.__ttDemoPinScroll;
    if (typeof prev === "function") body.removeEventListener("scroll", prev);
    const pin = () => {
      if (body.scrollTop !== y) body.scrollTop = y;
    };
    window.__ttDemoPinScroll = pin;
    body.addEventListener("scroll", pin);
  }, geo.freeze);
  try {
    await cdpDrag(cdp, geo.from, geo.to, TIMINGS.dragMs);
  } finally {
    await cdp.evaluate((y) => {
      const body = document.querySelector(".font-picker-body");
      const pin = window.__ttDemoPinScroll;
      if (body instanceof HTMLElement && typeof pin === "function") {
        body.removeEventListener("scroll", pin);
      }
      window.__ttDemoPinScroll = undefined;
      if (body instanceof HTMLElement) body.scrollTop = y;
    }, geo.freeze);
  }
}

async function ensureFamilyOnTop(cdp, family) {
  await cdp.evaluate((fam) => {
    const list = document.getElementById("fp-selected");
    if (!list) throw new Error("font picker closed (fallback chain gone)");
    const row = [...list.children].find(
      (el) => el instanceof HTMLElement && (el.dataset.family ?? "").toLowerCase() === fam.toLowerCase(),
    );
    if (!row) throw new Error(`${fam} not in fallback chain`);
    if (list.firstElementChild !== row) list.insertBefore(row, list.firstElementChild);
  }, family);
}

async function gotoTabPi(cdp, query) {
  await fireCombo(cdp, "ctrl+p");
  await cdp.waitFor(
    () => Boolean(document.querySelector(".pal-overlay .pal-input")),
    4000,
    "Ctrl+P overlay did not open",
  );
  await typeInto(cdp, ".pal-overlay .pal-input", query, TIMINGS.typeDelay);
  await sleep(TIMINGS.palListHold);
  await cdpEnter(cdp);
  await cdp.waitFor(() => !document.querySelector(".pal-overlay"), 4000, "Go to Tab did not close");
}

async function focusAgentTerminal(cdp) {
  await cdp.waitFor(
    () => {
      const page = document.querySelector(".settings-page");
      const settingsGone = !(page instanceof HTMLElement) || page.style.display === "none";
      const vis = [...document.querySelectorAll(".terminal-instance")].some(
        (el) => el instanceof HTMLElement && el.style.display !== "none",
      );
      return settingsGone && vis;
    },
    4000,
    "Agent tab did not show (Settings still covering the terminal)",
  );
  await cdp.evaluate(() => {
    const vis = [...document.querySelectorAll(".terminal-instance")].find(
      (el) => el instanceof HTMLElement && el.style.display !== "none",
    );
    const ta = vis?.querySelector(".xterm-helper-textarea");
    if (!(ta instanceof HTMLTextAreaElement)) throw new Error("visible terminal textarea missing");
    ta.focus();
  });
}

function runIme() {
  const py = pythonExe();
  if (!py) {
    throw new Error("drafts/demo/.venv missing — run: uv venv  (from drafts/demo)");
  }
  log(`IME SendInput via ${py}`);
  const r = spawnSync(py, [join(DIR, "ime_pinyin.py")], {
    cwd: DIR,
    stdio: "inherit",
    windowsHide: true,
  });
  if (r.status !== 0) throw new Error(`ime_pinyin.py exited ${r.status}`);
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

async function main() {
  if (hasFlag("probe")) {
    await probe();
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

    log("open Font Settings");
    await cdp.waitFor(
      () => Boolean(document.querySelector("#set-font-config")),
      4000,
      "Appearance Font Family Configure missing (#set-font-config)",
    );
    await cdp.evaluate(() => {
      const btn = document.querySelector("#set-font-config");
      if (!(btn instanceof HTMLElement)) throw new Error("missing #set-font-config");
      btn.scrollIntoView({ block: "center" });
      btn.click();
    });
    await cdp.waitFor(
      () => Boolean(document.querySelector(".font-picker-overlay .fp-search")),
      4000,
      "Font Settings did not open (.fp-search missing)",
    );
    await sleep(TIMINGS.afterOpenPicker);

    log("1a search jet + System NF");
    await typeInto(cdp, ".fp-search", QUERIES.fontSearch, TIMINGS.typeDelay);
    await sleep(TIMINGS.afterSearch);
    const family = await pickSystemNf(cdp);
    log(`adding ${family}`);
    await addSystemFamily(cdp, family);
    await cdp.waitFor(
      (fam) =>
        [...document.querySelectorAll("#fp-selected .fp-selected-item")].some(
          (el) => (el.dataset.family ?? "").toLowerCase() === fam.toLowerCase(),
        ),
      4000,
      `${family} did not appear in the fallback chain`,
      family,
    );
    await sleep(TIMINGS.afterAdd);

    log("preview terminal → Nerd Font line");
    await scrollPreviewToBottom(cdp);
    log("1b scroll chain to bottom (1s)");
    await scrollChainToBottom(cdp, family);
    await scrollPreviewToBottom(cdp);
    log("1b drag NF up (1s)");
    await dragAddedUp(cdp);
    await ensureFamilyOnTop(cdp, family);
    const top = (await chainFamilies(cdp))[0];
    if (top?.toLowerCase() !== family.toLowerCase()) {
      throw new Error(`chain top is ${top}, expected ${family}`);
    }
    await sleep(TIMINGS.afterDrag);

    log("1c Apply");
    await cdp.waitFor(
      () => Boolean(document.querySelector(".font-picker-overlay .fp-btn-apply")),
      4000,
      "Apply missing — font picker closed during drag",
    );
    await click(cdp, ".font-picker-overlay .fp-btn-apply");
    await cdp.waitFor(
      () => !document.querySelector(".font-picker-overlay"),
      4000,
      "font picker did not close after Apply",
    );
    await sleep(TIMINGS.afterApply);

    log(`Ctrl+P ${QUERIES.gotoTab} + Enter`);
    await gotoTabPi(cdp, QUERIES.gotoTab);
    await focusAgentTerminal(cdp);
    await sleep(TIMINGS.workingHold);

    if (hasFlag("skip-ime")) {
      log("skip-ime: chrome done");
      return;
    }
    await focusAgentTerminal(cdp);
    bringTtermForward(log);
    await sleep(150);
    log("2 Python scancodes 中文输入法");
    runIme();
    log("done");
  } finally {
    cdp.close();
  }
}

main().catch((err) => {
  console.error(`[agent] ${err.message}`);
  if (/fetch|ECONNREFUSED|not reachable|CDP|Unable to connect/i.test(String(err))) {
    console.error(
      "[agent] Start TTerm with WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 --remote-allow-origins=*",
    );
  }
  process.exit(1);
});
