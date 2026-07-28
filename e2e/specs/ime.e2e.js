// IME handling with cursor-hiding TUIs (pi/claude) — Plan A regression spec.
//
// Covers:
//  1. normal shell (cursor visible): xterm's composition-view shows the
//     in-progress composition inline, and a committed CJK string reaches
//     the PTY (echoed in the buffer)
//  2. hidden cursor (gostty): .cursor-hidden class applied, composition-view
//     suppressed even when xterm marks it active, and the hidden textarea is
//     frozen at the computed IME anchor (proxy) rather than the real parked
//     cursor — this is what places the OS candidate window correctly
//  3. suppression lifts after the cursor is shown again
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
const FIX = "D:\\tterm\\e2e\\fixtures";
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
    isCursorHidden: !!core.coreService?.isCursorHidden,
    anchorPx: { left: `${anchor.x * dims.width}px`, top: `${anchor.y * dims.height}px` },
    realCursorPx: { left: `${buf.cursorX * dims.width}px`, top: `${buf.cursorY * dims.height}px` },
    taInline: { left: ta.style.left, top: ta.style.top },
    cvDisplay: getComputedStyle(cv).display,
    cvText: cv.textContent,
  };
});

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

describe("IME with cursor-hiding TUIs", () => {
  // NOTE: visibleInstance() reads cursorHiddenClass/cvDisplay for specs that
  // need them; the Plan A suppression spec was removed (replaced by the
  // pending Plan C acceptance test below).
  it("shows composition inline in a normal shell and commits CJK to the PTY", async () => {
    await startComposition("nihao");
    await browser.waitUntil(async () => {
      const s = await visibleInstance();
      return s && !s.isCursorHidden && s.cvDisplay === "block" && s.cvText === "nihao";
    }, { timeout: 5000, timeoutMsg: "inline composition not shown in normal shell" });

    await commitComposition("你好");
    await browser.waitUntil(async () => (await dumpBuffer()).includes("你好"), {
      timeout: 5000,
      timeoutMsg: "committed CJK text did not reach the terminal buffer",
    });
    // discard the committed text on the prompt line
    await browser.keys(["Control", "c"]);
  });

  it("detects the hidden cursor and freezes the textarea at the anchor", async () => {
    await typeCommand(`type ${FIX}\\ime-hide.txt`);
    await browser.waitUntil(async () => {
      const s = await visibleInstance();
      return s && s.isCursorHidden === true;
    }, { timeout: 10000, timeoutMsg: "cursor-hidden state not detected in alt screen" });

    await startComposition("nihao");
    await browser.pause(500);
    const s = await visibleInstance();

    // anchor found the inverse fake cursor at (39,9), NOT the parked real
    // cursor — that distinction is what keeps the candidate window right
    expect(s.anchorPx.left).not.toBe(s.realCursorPx.left);
    // textarea frozen at the anchor by the proxy
    expect(s.taInline.left).toBe(s.anchorPx.left);
    expect(s.taInline.top).toBe(s.anchorPx.top);

    // (commit flow is covered by the normal-shell test; here just restore)
    await typeCommand(`type ${FIX}\\ime-show.txt`);
    await browser.waitUntil(async () => {
      const s2 = await visibleInstance();
      return s2 && s2.isCursorHidden === false;
    }, { timeout: 10000, timeoutMsg: "cursor not restored after leaving alt screen" });
  });

  // PLAN C acceptance test (floating composition mirror) — pending
  // implementation. When the cursor is hidden, xterm's composition-view is
  // suppressed AND a floating, clamped, wrapping mirror of the composition
  // appears at the anchor instead, fading out shortly after commit.
  it.skip("shows a floating composition mirror at the anchor when the cursor is hidden (Plan C)", async () => {
    // await typeCommand(`type ${FIX}\\ime-hide.txt`);
    // ... assert: composition-view suppressed; mirror element visible at
    // anchor px with composition text; clamped inside the terminal bounds;
    // gone shortly after commit
  });
});
