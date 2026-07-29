// IME handling with cursor-hiding TUIs (pi/claude) — Plan C regression spec.
//
// Covers:
//  1. normal shell (cursor visible, mode "auto"): xterm's native
//     composition-view shows the composition inline, the mirror stays out of
//     the way, and a committed CJK string reaches the PTY
//  2. hidden cursor (alt screen fixture): .cursor-hidden class applied, the
//     hidden textarea is frozen at the computed IME anchor (proxy) rather
//     than the real parked cursor — this places the OS candidate window
//  3. Plan C acceptance: hidden cursor → native composition-view suppressed,
//     floating mirror shows the composition at the anchor, clamped inside
//     the terminal even when the text grows, lingers briefly after commit,
//     then fades out
//  4. mode "always" (testing override): mirror + suppression active even in
//     a normal shell with a visible cursor
//
// Composition is simulated with dispatched CompositionEvent/InputEvent.
// (msedgedriver behind tauri-driver does not expose the /goog/cdp
// passthrough, so CDP Input.imeSetComposition is unavailable here. The
// dispatched events still exercise xterm's CompositionHelper and our
// document-level handlers; final validation with a real IME stays manual.)

// Deterministic hidden-cursor TUI fixture: raw VT sequences dumped via
// `type` (ConPTY forwards cursor visibility only in alt screen — gostty
// evidence — so 1049h is required). Draws ONE inverse cell at (39,9) as the
// fake cursor and parks the real cursor at (0,19), far away.
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
const FIX = resolve("e2e", "fixtures"); // absolute path on THIS machine
writeFileSync(`${FIX}\\ime-hide.txt`,
  "\x1b[?1049h\x1b[?25l\x1b[2J\x1b[H\x1b[10;40H\x1b[7m \x1b[0m\x1b[20;1H", "latin1");
writeFileSync(`${FIX}\\ime-show.txt`, "\x1b[?25h\x1b[?1049l", "latin1");

const visibleInstance = () => browser.execute(() => {
  const inst = [...document.querySelectorAll(".terminal-instance")].find((el) => el.style.display !== "none");
  const tab = [...window.__tterm.tabs.values()].find((t) => t.element === inst);
  if (!tab) return null;
  const ta = inst.querySelector(".xterm-helper-textarea");
  const cv = inst.querySelector(".composition-view");
  const core = tab.terminal._core;
  const dims = core._renderService.dimensions.css.cell;
  const buf = tab.terminal.buffer.active;
  const anchor = tab._imeAnchorCell();
  return {
    cursorHiddenClass: inst.classList.contains("cursor-hidden"),
    mirrorOnClass: inst.classList.contains("ime-mirror-on"),
    isCursorHidden: !!core.coreService?.isCursorHidden,
    cell: { w: dims.width, h: dims.height },
    anchorPx: { left: `${anchor.x * dims.width}px`, top: `${anchor.y * dims.height}px` },
    realCursorPx: { left: `${buf.cursorX * dims.width}px`, top: `${buf.cursorY * dims.height}px` },
    taInline: { left: ta.style.left, top: ta.style.top },
    cvDisplay: getComputedStyle(cv).display,
    cvText: cv.textContent,
  };
});

const mirrorState = () => browser.execute(() => {
  const inst = [...document.querySelectorAll(".terminal-instance")].find((el) => el.style.display !== "none");
  if (!inst) return null;
  const box = inst.querySelector(".ime-box");
  if (!box) return null;
  const r = box.getBoundingClientRect();
  const pr = inst.getBoundingClientRect();
  return {
    display: getComputedStyle(box).display,
    text: box.textContent,
    fading: box.classList.contains("fading"),
    style: { left: box.style.left, top: box.style.top },
    rect: { w: r.width, h: r.height },
    inside: r.left >= pr.left - 1 && r.right <= pr.right + 1 &&
            r.top >= pr.top - 1 && r.bottom <= pr.bottom + 1,
  };
});

const setMode = (m) => browser.execute((mm) => window.__tterm.setImeMirrorMode(mm), m);

const dumpBuffer = () => browser.execute(() => {
  const visible = [...document.querySelectorAll(".terminal-instance")].find((el) => el.style.display !== "none");
  const tab = [...window.__tterm.tabs.values()].find((t) => t.element === visible);
  if (!tab) return "";
  const buf = tab.terminal.buffer.active;
  let out = "";
  for (let i = 0; i < buf.length; i++) out += buf.getLine(i)?.translateToString(true) ?? "";
  return out;
});

async function startComposition(text) {
  await browser.execute((t) => {
    const inst = [...document.querySelectorAll(".terminal-instance")].find((el) => el.style.display !== "none");
    const ta = inst.querySelector(".xterm-helper-textarea");
    ta.focus();
    ta.dispatchEvent(new CompositionEvent("compositionstart"));
    ta.dispatchEvent(new CompositionEvent("compositionupdate", { data: t }));
  }, text);
}

async function updateComposition(text) {
  await browser.execute((t) => {
    const inst = [...document.querySelectorAll(".terminal-instance")].find((el) => el.style.display !== "none");
    const ta = inst.querySelector(".xterm-helper-textarea");
    ta.dispatchEvent(new CompositionEvent("compositionupdate", { data: t }));
  }, text);
}

async function commitComposition(text) {
  await browser.execute((t) => {
    const inst = [...document.querySelectorAll(".terminal-instance")].find((el) => el.style.display !== "none");
    const ta = inst.querySelector(".xterm-helper-textarea");
    ta.dispatchEvent(new CompositionEvent("compositionend", { data: t }));
    // what the textarea looks like after a real IME commit
    ta.value = t;
    ta.dispatchEvent(new InputEvent("input", { data: t, inputType: "insertText" }));
  }, text);
}

async function typeCommand(cmd) {
  await browser.execute(() => {
    [...document.querySelectorAll(".terminal-instance .xterm-helper-textarea")].pop().focus();
  });
  // discard anything sitting on the prompt line first (committed test text,
  // stray input) so the command itself is never polluted
  await browser.keys(["Control", "c"]);
  await browser.keys([...cmd, "Enter"]);
}

async function enterHiddenCursorFixture() {
  await typeCommand(`type ${FIX}\\ime-hide.txt`);
  await browser.waitUntil(async () => {
    const s = await visibleInstance();
    return s && s.isCursorHidden === true;
  }, { timeout: 10000, timeoutMsg: "cursor-hidden state not detected in alt screen" });
}

async function leaveHiddenCursorFixture() {
  await typeCommand(`type ${FIX}\\ime-show.txt`);
  await browser.waitUntil(async () => {
    const s = await visibleInstance();
    return s && s.isCursorHidden === false;
  }, { timeout: 10000, timeoutMsg: "cursor not restored after leaving alt screen" });
}

describe("IME with cursor-hiding TUIs", () => {
  it("shows composition inline in a normal shell and commits CJK to the PTY", async () => {
    await setMode("auto"); // native xterm path; mirror must stay out of the way
    await startComposition("nihao");
    await browser.waitUntil(async () => {
      const s = await visibleInstance();
      return s && !s.isCursorHidden && s.cvDisplay === "block" && s.cvText === "nihao";
    }, { timeout: 5000, timeoutMsg: "inline composition not shown in normal shell" });
    const m = await mirrorState();
    expect(m.display).toBe("none"); // mirror inactive in auto+visible cursor

    await commitComposition("你好");
    await browser.waitUntil(async () => (await dumpBuffer()).includes("你好"), {
      timeout: 5000,
      timeoutMsg: "committed CJK text did not reach the terminal buffer",
    });
    // discard the committed text on the prompt line
    await browser.keys(["Control", "c"]);
  });

  it("detects the hidden cursor and freezes the textarea at the anchor", async () => {
    await setMode("auto");
    await enterHiddenCursorFixture();

    await startComposition("nihao");
    await browser.pause(500);
    const s = await visibleInstance();

    expect(s.cursorHiddenClass).toBe(true);
    expect(s.mirrorOnClass).toBe(true);
    // anchor found the inverse fake cursor at (39,9), NOT the parked real
    // cursor — that distinction is what keeps the candidate window right
    expect(s.anchorPx.left).not.toBe(s.realCursorPx.left);
    // textarea frozen at the anchor by the proxy
    expect(s.taInline.left).toBe(s.anchorPx.left);
    expect(s.taInline.top).toBe(s.anchorPx.top);

    await leaveHiddenCursorFixture();
  });

  // PLAN C acceptance test: with the cursor hidden, xterm's composition-view
  // is suppressed AND a floating, clamped, wrapping mirror of the composition
  // appears at the anchor instead, fading out shortly after commit.
  it("shows a floating composition mirror at the anchor when the cursor is hidden (Plan C)", async () => {
    await setMode("auto");
    await enterHiddenCursorFixture();

    await startComposition("nihao");
    await browser.waitUntil(async () => {
      const m = await mirrorState();
      return m && m.display === "block" && m.text === "nihao";
    }, { timeout: 5000, timeoutMsg: "mirror did not show the composition" });

    const s = await visibleInstance();
    const m = await mirrorState();
    // native composition-view suppressed while the mirror owns display
    expect(s.cvDisplay).toBe("none");
    // anchored at the fake cursor, not the parked real cursor (0,19)
    expect(m.style.left).not.toBe("0px");
    expect(m.style.left).not.toBe("4px"); // not clamped to the left edge
    expect(parseInt(m.style.left, 10)).toBeLessThanOrEqual(parseInt(s.anchorPx.left, 10) + 1);
    // bottom-aligned with the anchor row: box bottom edge flush with the
    // anchor row's bottom (grows upward on wrap, stays clear of the OS
    // candidate window below the line)
    const expectedTop = parseFloat(s.anchorPx.top) + s.cell.h - m.rect.h;
    expect(Math.abs(parseFloat(m.style.top) - expectedTop)).toBeLessThanOrEqual(1);
    expect(m.rect.h).toBeGreaterThan(0);
    expect(m.inside).toBe(true);

    // text grows → mirror wraps and re-clamps (deferred to rAF), never
    // leaves the terminal
    await updateComposition("a".repeat(160));
    await browser.waitUntil(async () => {
      const mm = await mirrorState();
      return mm && mm.text === "a".repeat(160) && mm.inside;
    }, { timeout: 3000, timeoutMsg: "mirror did not re-clamp inside the terminal" });

    // commit → mirror disappears immediately (0ms linger + 0ms fade)
    await commitComposition("你好");
    await browser.waitUntil(async () => {
      const mm = await mirrorState();
      return mm && mm.display === "none";
    }, { timeout: 3000, timeoutMsg: "mirror did not disappear after commit" });

    await leaveHiddenCursorFixture();
  });

  it("mirrors compositions in a normal shell when mode is 'always' (testing override)", async () => {
    await setMode("always");
    await startComposition("nihao");
    await browser.waitUntil(async () => {
      const m = await mirrorState();
      return m && m.display === "block" && m.text === "nihao";
    }, { timeout: 5000, timeoutMsg: "mirror did not show in always mode" });
    const s = await visibleInstance();
    expect(s.isCursorHidden).toBe(false);
    expect(s.mirrorOnClass).toBe(true);
    expect(s.cvDisplay).toBe("none"); // native view suppressed, no double render
    const m = await mirrorState();
    expect(m.inside).toBe(true);

    await commitComposition("你好");
    await browser.waitUntil(async () => (await mirrorState()).display === "none", {
      timeout: 3000, timeoutMsg: "mirror did not fade out after commit",
    });
    await browser.waitUntil(async () => (await dumpBuffer()).includes("你好"), {
      timeout: 5000, timeoutMsg: "committed CJK text did not reach the terminal buffer",
    });
    await browser.keys(["Control", "c"]);
    await setMode("auto");
  });
});
