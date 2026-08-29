import { spawnSync } from "node:child_process";
import { openSession, sleep, waitForPage } from "./cdp.mjs";

export function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!hit) return fallback;
  return hit.slice(name.length + 3);
}

export function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

export function makeLog(prefix) {
  return (msg) => console.log(`[${prefix}] ${msg}`);
}

export function bringTtermForward(log) {
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

export async function hideCursor(cdp) {
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

export async function typeInto(cdp, selector, text, delayMs) {
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

export async function click(cdp, selector) {
  await cdp.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error(`missing ${sel}`);
    el.click();
  }, selector);
}

export async function countdown(seconds, log) {
  for (let n = seconds; n > 0; n--) {
    log(`record in ${n}…`);
    await sleep(1000);
  }
}

export async function connectCdp(port, log) {
  log(`connecting CDP :${port}`);
  const { page } = await waitForPage(port, 8000);
  log(`attached ${page.title} ${page.url}`);
  return openSession(page.webSocketDebuggerUrl);
}
