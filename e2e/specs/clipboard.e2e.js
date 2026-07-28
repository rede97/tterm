import { execSync } from "node:child_process";

// The marker is echoed by the shell so it appears on a line by itself.
const MARKER = "RTCOPY_XYZZY_4242";
const PASTE_TEXT = "RTPASTE_Q_777";

function ps(cmd) {
  return execSync(`powershell -NoProfile -Command "${cmd}"`, { encoding: "utf8" });
}
function readClipboard() {
  try {
    return ps("Get-Clipboard -Raw");
  } catch {
    return "";
  }
}
function writeClipboard(text) {
  ps(`Set-Clipboard -Value '${text}'`);
}

// Locate the marker line in the active terminal and return the pixel geometry
// needed to drag-select it precisely. Coordinates are viewport (client) px.
async function markerGeometry(marker) {
  return browser.execute((m) => {
    const mgr = window.__tterm.mgr;
    const tab = mgr.get(mgr.activeTabId);
    if (!tab) return null;
    const term = tab.terminal;
    const buf = term.buffer.active;
    // Find the line whose trimmed content is exactly the marker (echo output).
    let row = -1, col = -1;
    for (let i = buf.length - 1; i >= 0; i--) {
      const line = buf.getLine(i);
      if (!line) continue;
      const text = line.translateToString(true);
      if (text.trim() === m) {
        row = i - buf.viewportY; // viewport row (viewportY = buffer line at top of viewport)
        col = text.indexOf(m);
        break;
      }
    }
    if (row < 0 || col < 0) return null;
    const core = term._core;
    const cell = core._renderService.dimensions.css.cell;
    const screenEl = core.screenElement;
    const rect = screenEl.getBoundingClientRect();
    const cs = getComputedStyle(screenEl);
    return {
      row,
      col,
      len: m.length,
      cellW: cell.width,
      cellH: cell.height,
      originX: rect.left + (parseInt(cs.paddingLeft) || 0),
      originY: rect.top + (parseInt(cs.paddingTop) || 0),
    };
  }, marker);
}

async function activeSelection() {
  return browser.execute(() => {
    const mgr = window.__tterm.mgr;
    const tab = mgr.get(mgr.activeTabId);
    return tab ? tab.terminal.getSelection() : null;
  });
}

// Read + clear the right-click handler diagnostics (see tab.ts TEMP DIAG).
async function drainDiag(label) {
  const diag = await browser.execute(() => {
    const d = window.__rtDiag || [];
    window.__rtDiag = [];
    return d;
  });
  console.log(`[diag:${label}]`, JSON.stringify(diag));
  return diag;
}

// Rich snapshot of the selection model, for diagnosing failures.
async function selectionDebug() {
  return browser.execute(() => {
    const mgr = window.__tterm.mgr;
    const tab = mgr.get(mgr.activeTabId);
    if (!tab) return null;
    const term = tab.terminal;
    const core = term._core;
    const sm = core && core._selectionService;
    return {
      getSelection: term.getSelection(),
      hasSelection: sm ? sm.hasSelection : null,
      modelStart: sm && sm._model ? sm._model.selectionStart : null,
      modelEnd: sm && sm._model ? sm._model.selectionEnd : null,
      enabled: sm ? sm._enabled : null,
    };
  });
}

async function dumpBuffer() {
  return browser.execute(() => {
    const mgr = window.__tterm.mgr;
    const tab = mgr.get(mgr.activeTabId);
    if (!tab) return "";
    const buf = tab.terminal.buffer.active;
    let out = "";
    for (let i = 0; i < buf.length; i++) {
      out += (buf.getLine(i) ? buf.getLine(i).translateToString(true) : "") + "\n";
    }
    return out;
  });
}

describe("terminal right-click copy/paste", () => {
  it("right-click on a mouse-drag selection copies it to the system clipboard", async () => {
    // Wait for the app to be ready: the initial terminal tab must exist
    // (config + WT profiles load asynchronously before the first tab opens).
    await $("#tab-bar").waitForExist({ timeout: 20000 });
    await browser.waitUntil(async () => (await $$("#tabs .tab")).length >= 1, {
      timeout: 20000,
      timeoutMsg: "initial tab did not appear",
    });

    // Fresh local shell tab.
    const before = (await $$("#tabs .tab")).length;
    await $("#new-tab").click();
    await browser.waitUntil(
      async () => (await $$("#tabs .tab")).length === before + 1,
      { timeout: 15000 }
    );
    await browser.pause(1200); // let the shell print its prompt

    // Focus the terminal and print a known marker line.
    await browser.execute(() => {
      const mgr = window.__tterm.mgr;
      mgr.get(mgr.activeTabId).terminal.focus();
    });
    await browser.keys([..."echo "].concat([...MARKER]).concat(["Enter"]));

    // Wait until the marker line is present in the buffer.
    await browser.waitUntil(async () => (await markerGeometry(MARKER)) !== null, {
      timeout: 10000,
      timeoutMsg: "marker line not found in terminal buffer",
    });

    const g = await markerGeometry(MARKER);
    // xterm selection coords: col = ceil((x + cellW/2) / cellW). Pick points
    // just inside the left edge of the first cell and right edge of the last.
    const startX = Math.round(g.originX + g.col * g.cellW + 2);
    const endX = Math.round(g.originX + (g.col + g.len) * g.cellW - 2);
    const y = Math.round(g.originY + g.row * g.cellH + g.cellH / 2);

    // Drag to select the marker.
    await browser.action("pointer")
      .move({ x: startX, y })
      .down()
      .pause(80)
      .move({ x: endX, y, duration: 120 })
      .pause(80)
      .up()
      .perform();
    await browser.pause(250);

    const selAfterDrag = await activeSelection();
    if (selAfterDrag !== MARKER) {
      console.log("[diag] after drag:", JSON.stringify(await selectionDebug()));
    }
    expect(selAfterDrag).toBe(MARKER);

    // Right-click (no shift) in the middle of the selection -> should copy.
    const midX = Math.round((startX + endX) / 2);
    await browser.action("pointer")
      .move({ x: midX, y })
      .pause(60)
      .down(2)
      .up(2)
      .perform();
    await browser.pause(400);

    await drainDiag("test1-single-line");

    const selAfterRightClick = await activeSelection();
    if (selAfterRightClick !== "") {
      console.log("[diag] after right-click:", JSON.stringify(await selectionDebug()));
    }
    // The copy path clears the selection.
    expect(selAfterRightClick).toBe("");

    // The system clipboard must now contain the marker.
    await browser.pause(600);
    const clip = readClipboard();
    if (!clip.includes(MARKER)) {
      console.log("[diag] clipboard:", JSON.stringify(clip));
    }
    expect(clip).toContain(MARKER);
  });

  it("right-click copies a multi-line selection", async () => {
    // Print three marker lines, then drag-select across all of them.
    await browser.execute(() => {
      const mgr = window.__tterm.mgr;
      mgr.get(mgr.activeTabId).terminal.focus();
    });
    await browser.keys([...'echo MLAAA; echo MLBBB; echo MLCCC'].concat(['Enter']));
    await browser.waitUntil(async () => (await markerGeometry('MLCCC')) !== null, {
      timeout: 10000,
      timeoutMsg: 'multi-line markers not found',
    });

    const gStart = await markerGeometry('MLAAA');
    const gEnd = await markerGeometry('MLCCC');
    const startX = Math.round(gStart.originX + gStart.col * gStart.cellW + 2);
    const startY = Math.round(gStart.originY + gStart.row * gStart.cellH + gStart.cellH / 2);
    const endX = Math.round(gEnd.originX + (gEnd.col + gEnd.len) * gEnd.cellW - 2);
    const endY = Math.round(gEnd.originY + gEnd.row * gEnd.cellH + gEnd.cellH / 2);

    await browser.action('pointer')
      .move({ x: startX, y: startY })
      .down()
      .pause(80)
      .move({ x: endX, y: endY, duration: 150 })
      .pause(80)
      .up()
      .perform();
    await browser.pause(250);

    const sel = await activeSelection();
    if (!(sel && sel.includes('MLAAA') && sel.includes('MLBBB') && sel.includes('MLCCC'))) {
      console.log('[diag] multi-line selection:', JSON.stringify(sel));
    }
    expect(sel).toContain('MLAAA');
    expect(sel).toContain('MLBBB');
    expect(sel).toContain('MLCCC');

    // Right-click on the middle line -> copies the whole multi-line selection.
    const midX = Math.round(gEnd.originX + gEnd.col * gEnd.cellW + 2);
    const midY = Math.round(gEnd.originY + (gEnd.row - 1) * gEnd.cellH + gEnd.cellH / 2);
    await browser.action('pointer')
      .move({ x: midX, y: midY })
      .pause(60)
      .down(2)
      .up(2)
      .perform();
    await browser.pause(600);

    await drainDiag("test2-multi-line");

    expect(await activeSelection()).toBe('');
    const clip = readClipboard();
    if (!clip.includes('MLBBB')) console.log('[diag] clipboard:', JSON.stringify(clip));
    expect(clip).toContain('MLAAA');
    expect(clip).toContain('MLBBB');
    expect(clip).toContain('MLCCC');
  });

  it("right-click with no selection pastes from the clipboard", async () => {
    writeClipboard(PASTE_TEXT);

    // Ensure no selection and focus the terminal.
    await browser.execute(() => {
      const mgr = window.__tterm.mgr;
      const tab = mgr.get(mgr.activeTabId);
      tab.terminal.clearSelection();
      tab.terminal.focus();
    });
    expect(await activeSelection()).toBe("");

    // Right-click on the (empty) marker line area again.
    const g = await markerGeometry(MARKER);
    const x = Math.round(g.originX + g.col * g.cellW + 2);
    const y = Math.round(g.originY + g.row * g.cellH + g.cellH / 2);
    await browser.action("pointer")
      .move({ x, y })
      .pause(60)
      .down(2)
      .up(2)
      .perform();
    await browser.pause(700);

    await drainDiag("test3-paste");

    // The pasted text lands on the shell input line somewhere in the buffer.
    const dumped = await dumpBuffer();
    if (!dumped.includes(PASTE_TEXT)) {
      console.log("[diag] buffer after paste:\n" + dumped);
    }
    expect(dumped).toContain(PASTE_TEXT);
  });
});
