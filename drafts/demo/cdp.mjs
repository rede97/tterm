// Minimal Chrome DevTools Protocol client for a running WebView2.
// Used by the README demo injector — attaches to TTerm, does not spawn it.

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function listTargets(port) {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`);
  if (!res.ok) throw new Error(`CDP /json/list HTTP ${res.status}`);
  return res.json();
}

export function pickPage(targets) {
  const pages = targets.filter(
    (t) =>
      (t.type === "page" || t.type === "webview") &&
      typeof t.webSocketDebuggerUrl === "string" &&
      !String(t.url ?? "").startsWith("devtools://"),
  );
  const scored = pages.map((t) => {
    const url = String(t.url ?? "");
    let score = 0;
    if (url.includes("tauri.localhost") || url.includes("tauri://")) score += 3;
    if (url.includes("127.0.0.1:1420")) score += 2;
    if (/tterm/i.test(String(t.title ?? ""))) score += 1;
    return { t, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return (scored[0] ?? pages[0])?.t ?? null;
}

export async function waitForPage(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastErr = null;
  while (Date.now() < deadline) {
    try {
      const targets = await listTargets(port);
      const page = pickPage(targets);
      if (page) return { page, targets };
      lastErr = new Error(
        `no WebView page on :${port} (saw ${targets.length} target(s))`,
      );
    } catch (err) {
      lastErr = err;
    }
    await sleep(250);
  }
  throw lastErr ?? new Error(`CDP :${port} not reachable`);
}

export class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(String(ev.data));
      if (msg.id == null) return;
      const pending = this.pending.get(msg.id);
      if (!pending) return;
      this.pending.delete(msg.id);
      if (msg.error) pending.reject(new Error(msg.error.message ?? JSON.stringify(msg.error)));
      else pending.resolve(msg.result);
    });
  }

  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.ws.close();
  }

  async evaluate(fn, ...args) {
    const expression = `(${fn.toString()})(${args.map((a) => JSON.stringify(a)).join(",")})`;
    const result = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) {
      const d = result.exceptionDetails;
      const text = d.exception?.description || d.text || "evaluate failed";
      throw new Error(text);
    }
    return result.result?.value;
  }

  async waitFor(fn, timeoutMs, message, ...args) {
    const deadline = Date.now() + timeoutMs;
    let last = null;
    while (Date.now() < deadline) {
      last = await this.evaluate(fn, ...args);
      if (last) return last;
      await sleep(50);
    }
    throw new Error(message ?? `waitFor timed out after ${timeoutMs}ms`);
  }
}

export async function openSession(webSocketDebuggerUrl) {
  const ws = new WebSocket(webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", () => reject(new Error("CDP WebSocket failed")), {
      once: true,
    });
  });
  const cdp = new Cdp(ws);
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");
  return cdp;
}

/** Combo the in-page keymap understands (window capture listener). */
export async function fireCombo(cdp, combo) {
  const parts = combo.toLowerCase().split("+");
  const key = parts.at(-1);
  const ctrlKey = parts.includes("ctrl");
  const shiftKey = parts.includes("shift");
  const altKey = parts.includes("alt");
  const metaKey = parts.includes("meta");
  await cdp.evaluate(
    (opts) => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: opts.key,
          code: opts.code,
          ctrlKey: opts.ctrlKey,
          shiftKey: opts.shiftKey,
          altKey: opts.altKey,
          metaKey: opts.metaKey,
          bubbles: true,
          cancelable: true,
        }),
      );
    },
    {
      key,
      code: /^[a-z]$/.test(key) ? `Key${key.toUpperCase()}` : key,
      ctrlKey,
      shiftKey,
      altKey,
      metaKey,
    },
  );
}

export async function fireKeyOn(cdp, selector, key, code) {
  await cdp.evaluate(
    (sel, k, c) => {
      const el = sel ? document.querySelector(sel) : document.activeElement;
      if (!el) throw new Error(`no target for key ${k}`);
      el.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: k,
          code: c ?? k,
          bubbles: true,
          cancelable: true,
        }),
      );
    },
    selector,
    key,
    code,
  );
}

const VK = {
  Tab: 9,
  Enter: 13,
  Control: 17,
  Shift: 16,
};

/** Trusted Tab / character input via CDP (needed for native focus move + xterm). */
export async function cdpKey(cdp, spec) {
  const { type, key, code, vk, modifiers = 0, text } = spec;
  const params = {
    type,
    modifiers,
    key,
    code,
    windowsVirtualKeyCode: vk,
    nativeVirtualKeyCode: vk,
  };
  if (text) {
    params.text = text;
    params.unmodifiedText = text;
  }
  await cdp.send("Input.dispatchKeyEvent", params);
}

export async function cdpTab(cdp) {
  await cdpKey(cdp, { type: "keyDown", key: "Tab", code: "Tab", vk: VK.Tab });
  await cdpKey(cdp, { type: "keyUp", key: "Tab", code: "Tab", vk: VK.Tab });
}

export async function cdpEnter(cdp) {
  // keyDown already makes xterm onData("\r"). A following char "\r" submits
  // a second empty line — AT line-mode echoes another blank row.
  await cdpKey(cdp, { type: "keyDown", key: "Enter", code: "Enter", vk: VK.Enter });
  await cdpKey(cdp, { type: "keyUp", key: "Enter", code: "Enter", vk: VK.Enter });
}

export async function cdpType(cdp, text, delayMs) {
  for (const ch of text) {
    // ASCII of " - . collides with VK_NEXT / VK_INSERT / VK_DELETE — xterm
    // then emits CSI and line-mode echoes [6~ [2~ [3~. Only letters/digits
    // have ASCII == VK. Everything else is insertText.
    if (/[a-zA-Z0-9 ]/.test(ch)) {
      const upper = ch.toUpperCase();
      const isLetter = /[a-zA-Z]/.test(ch);
      const isDigit = ch >= "0" && ch <= "9";
      const code = isLetter ? `Key${upper}` : isDigit ? `Digit${ch}` : "Space";
      const vk = ch === " " ? 32 : upper.charCodeAt(0);
      await cdpKey(cdp, { type: "rawKeyDown", key: ch, code, vk });
      await cdpKey(cdp, { type: "char", key: ch, code, vk, text: ch });
      await cdpKey(cdp, { type: "keyUp", key: ch, code, vk });
    } else {
      await cdp.send("Input.insertText", { text: ch });
    }
    if (delayMs) await sleep(delayMs);
  }
}

export async function cdpMove(cdp, x, y, buttons = 0) {
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x,
    y,
    button: buttons ? "left" : "none",
    buttons,
  });
}

export async function cdpDrag(cdp, from, to, durationMs = 280) {
  const steps = Math.max(12, Math.round(durationMs / 50));
  await cdpMove(cdp, from.x, from.y);
  await sleep(40);
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: from.x,
    y: from.y,
    button: "left",
    buttons: 1,
    clickCount: 1,
  });
  await sleep(80);
  await cdpMove(cdp, from.x, from.y - 12, 1);
  await sleep(40);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    await cdpMove(cdp, from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t, 1);
    await sleep(durationMs / steps);
  }
  await sleep(80);
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: to.x,
    y: to.y,
    button: "left",
    buttons: 0,
    clickCount: 1,
  });
}
