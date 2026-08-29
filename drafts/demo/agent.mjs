#!/usr/bin/env bun
// Scene 2 / agent.gif injector. CDP for the font picker; uv/Python SendInput
// for 中文输入法. Does not use window.__tterm.
//
// Same WebView2 CDP launch as hero. Arrange: Font Settings open, Search empty,
// NF not yet in the fallback chain, local Agent tab running Working behind Settings.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cdpDrag, fireCombo, fireKeyOn, listTargets, pickPage, sleep } from "./cdp.mjs";
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
  afterSearch: 400,
  afterAdd: 400,
  afterDrag: 350,
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
    add.click();
  }, family);
}

async function chainFamilies(cdp) {
  return cdp.evaluate(() =>
    [...document.querySelectorAll("#fp-selected .fp-selected-item")].map((el) => el.dataset.family),
  );
}

async function itemRect(cdp, index) {
  return cdp.evaluate((i) => {
    const el = document.querySelectorAll("#fp-selected .fp-selected-item")[i];
    if (!el) return null;
    const grip = el.querySelector(".fp-drag-grip") ?? el;
    const r = grip.getBoundingClientRect();
    return {
      x: Math.round(r.left + r.width / 2),
      y: Math.round(r.top + r.height / 2),
      h: Math.round(r.height),
    };
  }, index);
}

async function dragAddedToTop(cdp) {
  const fams = await chainFamilies(cdp);
  if (!fams?.length) throw new Error("fallback chain empty after add");
  const last = fams.length - 1;
  const gLast = await itemRect(cdp, last);
  const g0 = await itemRect(cdp, 0);
  if (!gLast || !g0) throw new Error("could not measure fallback rows");
  await cdpDrag(cdp, { x: gLast.x, y: gLast.y }, { x: g0.x, y: g0.y - Math.round(g0.h / 2) - 4 });
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
  await fireKeyOn(cdp, ".pal-overlay .pal-input", "Enter", "Enter");
  await cdp.waitFor(() => !document.querySelector(".pal-overlay"), 4000, "Go to Tab did not close");
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

    log("1a search jet + System NF");
    await cdp.waitFor(
      () => Boolean(document.querySelector(".font-picker-overlay .fp-search")),
      4000,
      "Font Settings not open (.fp-search missing)",
    );
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

    log("1b drag NF to top");
    await dragAddedToTop(cdp);
    await sleep(TIMINGS.afterDrag);
    const top = (await chainFamilies(cdp))[0];
    if (top?.toLowerCase() !== family.toLowerCase()) {
      log(`warning: chain top is ${top}, expected ${family} — continuing`);
    }

    log("1c Apply");
    await click(cdp, ".fp-btn-apply");
    await cdp.waitFor(
      () => !document.querySelector(".font-picker-overlay"),
      4000,
      "font picker did not close after Apply",
    );
    await sleep(TIMINGS.afterApply);

    log(`Ctrl+P ${QUERIES.gotoTab} + Enter`);
    await gotoTabPi(cdp, QUERIES.gotoTab);
    await cdp.evaluate(() => {
      const vis = [...document.querySelectorAll(".terminal-instance")].find(
        (el) => el instanceof HTMLElement && el.style.display !== "none",
      );
      const ta = vis?.querySelector(".xterm-helper-textarea");
      if (ta instanceof HTMLTextAreaElement) ta.focus();
    });
    await sleep(TIMINGS.workingHold);

    if (hasFlag("skip-ime")) {
      log("skip-ime: chrome done");
      return;
    }
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
