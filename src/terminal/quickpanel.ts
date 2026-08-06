// Quick-status button + dropdown panel at the right end of the tab bar.
// Shows the ACTIVE tab's session state (disconnected / shared) and offers
// quick actions per session type:
//   every tab : AI share toggle (+ link copy)
//   ssh       : auto-reconnect toggle (timed retry); embedded client also
//               lists port forwards and adds new ones inline
//   serial    : auto-reconnect toggle (re-plug detection), baud / newline
//               selects, RTS line toggle, CTS line status
//
// Like contextmenu, this module never imports TabManager: actions go
// through handlers injected by main.ts (setQuickPanelHandlers), keeping the
// module graph acyclic. TabManager calls updateQuickButton()/closeQuickPanel()
// on switch/close/share.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { createElement, SlidersHorizontal } from "lucide";
import { writeText as clipboardWriteText } from "@tauri-apps/plugin-clipboard-manager";
import { SERIAL_BAUD_RATES, SERIAL_OUTPUT_NEWLINES, SERIAL_ENTER_NEWLINES } from "../core/common";
import type { SerialEnterNewline, SerialOutputNewline } from "../core/types";
import { showToast } from "../ui/toast";
import { logCatch } from "../core/errorlog";
import type { TerminalTab } from "./tab";

// ---- Injected handlers ----

export interface QuickPanelHandlers {
  getActiveTab: () => TerminalTab | undefined;
  getTab: (tabId: string) => TerminalTab | undefined;
  shareTab: (tabId: string) => Promise<void>;
  setSerialBaud: (tabId: string, baud: number) => Promise<void>;
  setSerialOutputNewline: (tabId: string, mode: SerialOutputNewline) => Promise<void>;
  setSerialEnterNewline: (tabId: string, mode: SerialEnterNewline) => Promise<void>;
}

let _handlers: QuickPanelHandlers | null = null;

export function setQuickPanelHandlers(h: QuickPanelHandlers): void {
  _handlers = h;
}

interface ForwardInfo {
  forwardId: number;
  kind: string;
  listenHost: string;
  listenPort: number;
  targetHost: string;
  targetPort: number;
}

interface SerialLineState {
  rts: boolean;
  cts: boolean;
}

// A toggle row whose visual state can be corrected asynchronously (backend
// state reads land after the row is already rendered).
interface ToggleRow extends HTMLElement {
  setOn(on: boolean): void;
}

let panel: HTMLElement | null = null;
// The tab the open panel is bound to; null while closed.
let panelTabId: string | null = null;

function qsButton(): HTMLButtonElement | null {
  return document.getElementById("quick-status") as HTMLButtonElement | null;
}

function el(tag: string, className: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function mkSection(title: string, key: string): HTMLElement {
  const sec = el("div", "qp-section");
  sec.dataset.section = key;
  sec.appendChild(el("div", "qp-section-title", title));
  return sec;
}

function mkToggle(label: string, on: boolean, onFlip: (on: boolean) => void): ToggleRow {
  const row = el("div", "qp-row qp-toggle-row") as ToggleRow;
  row.appendChild(el("span", "qp-label", label));
  const sw = document.createElement("button");
  sw.type = "button";
  sw.className = "qp-switch";
  sw.setAttribute("role", "switch");
  sw.setAttribute("aria-label", label);
  sw.appendChild(el("span", "qp-knob"));
  const apply = (v: boolean) => {
    sw.classList.toggle("on", v);
    sw.setAttribute("aria-checked", String(v));
  };
  apply(on);
  row.setOn = apply;
  sw.addEventListener("click", () => {
    const next = !sw.classList.contains("on");
    apply(next);
    onFlip(next);
  });
  row.appendChild(sw);
  return row;
}

function mkSelectRow(
  label: string,
  options: readonly (readonly [string, string])[],
  current: string,
  onChange: (value: string) => void,
): HTMLElement {
  const row = el("div", "qp-row");
  row.appendChild(el("span", "qp-label", label));
  const sel = document.createElement("select");
  sel.className = "qp-select";
  sel.setAttribute("aria-label", label);
  for (const [value, text] of options) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = text;
    sel.appendChild(opt);
  }
  sel.value = current;
  sel.addEventListener("change", () => onChange(sel.value));
  row.appendChild(sel);
  return row;
}

// -- sections --

function shareSection(tab: TerminalTab): HTMLElement {
  const sec = mkSection("AI Share", "share");
  sec.appendChild(mkToggle("Share this session", tab.shared, (on) => {
    const t = _handlers?.getTab(tab.id);
    if (!t) return;
    const flip = t.shared !== on ? _handlers!.shareTab(tab.id) : Promise.resolve();
    flip
      .then(() => {
        updateQuickButton();
        if (panelTabId === tab.id) renderPanel(t);
      })
      .catch(logCatch("quickpanel.share"));
  }));
  if (tab.shared && tab.shareUrl) {
    const row = el("div", "qp-row qp-share-url-row");
    const url = el("span", "qp-share-url", tab.shareUrl);
    url.title = tab.shareUrl;
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "qp-mini-btn";
    copy.textContent = "Copy";
    copy.addEventListener("click", () => {
      clipboardWriteText(tab.shareUrl!)
        .then(() => showToast("Share link copied", "info"))
        .catch(logCatch("clipboard.write"));
    });
    row.appendChild(url);
    row.appendChild(copy);
    sec.appendChild(row);
  }
  return sec;
}

// Auto-reconnect toggle shared by the SSH and serial sections. The backend
// retries respawn on a timer while the session is dead (for serial sessions
// a failed open simply means the device is still unplugged).
function autoReconnectRow(tab: TerminalTab): ToggleRow {
  const row = mkToggle("Auto-reconnect", false, (on) => {
    invoke("session_set_auto_reconnect", { id: tab.id, enabled: on })
      .catch((e) => showToast(`Auto-reconnect: ${e}`, "error"));
  });
  invoke<boolean>("session_get_auto_reconnect", { id: tab.id })
    .then((v) => row.setOn(v))
    .catch(() => { /* session without reconnect support: stays off */ });
  return row;
}

function sshSection(tab: TerminalTab): HTMLElement {
  const sec = mkSection("SSH", "ssh");
  sec.appendChild(autoReconnectRow(tab));
  if (tab.sshEmbedded) {
    sec.appendChild(forwardsBlock(tab));
  }
  return sec;
}

function forwardsBlock(tab: TerminalTab): HTMLElement {
  const wrap = el("div", "qp-fwd");
  wrap.appendChild(el("div", "qp-sub-title", "Port Forwards"));
  const list = el("div", "qp-fwd-list");
  wrap.appendChild(list);

  const renderList = (forwards: ForwardInfo[]) => {
    list.innerHTML = "";
    if (forwards.length === 0) {
      list.appendChild(el("div", "qp-fwd-empty", "No active port forwards."));
      return;
    }
    for (const f of forwards) {
      const row = el("div", "qp-fwd-row");
      row.appendChild(el("span", `fwd-badge fwd-badge-${f.kind === "remote" ? "remote" : "local"}`, f.kind === "remote" ? "R" : "L"));
      row.appendChild(el("span", "qp-fwd-route", `${f.listenHost}:${f.listenPort} → ${f.targetHost}:${f.targetPort}`));
      const rm = document.createElement("button");
      rm.type = "button";
      rm.className = "qp-mini-btn qp-fwd-remove";
      rm.textContent = "✕";
      rm.title = "Remove forward";
      rm.addEventListener("click", () => {
        invoke("ssh_forward_remove", { id: tab.id, forwardId: f.forwardId })
          .then(refresh)
          .catch((e) => showToast(`Failed to remove port forward: ${e}`, "error"));
      });
      row.appendChild(rm);
      list.appendChild(row);
    }
  };

  const refresh = (): Promise<void> =>
    invoke<ForwardInfo[]>("ssh_forward_list", { id: tab.id })
      .then(renderList)
      .catch((e) => {
        list.innerHTML = "";
        list.appendChild(el("div", "qp-fwd-empty", String(e)));
      });

  // Compact add form: kind + ports; hosts default to loopback.
  const form = el("div", "qp-fwd-add");
  const kind = document.createElement("select");
  kind.className = "qp-select qp-fwd-kind";
  kind.setAttribute("aria-label", "Forward kind");
  for (const [v, text] of [["local", "Local (-L)"], ["remote", "Remote (-R)"]] as const) {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = text;
    kind.appendChild(opt);
  }
  const mkPort = (placeholder: string, label: string): HTMLInputElement => {
    const input = document.createElement("input");
    input.className = "qp-input qp-fwd-port";
    input.type = "number";
    input.min = "1";
    input.max = "65535";
    input.placeholder = placeholder;
    input.setAttribute("aria-label", label);
    return input;
  };
  const listenPort = mkPort("Listen", "Listen port");
  const targetHost = document.createElement("input");
  targetHost.className = "qp-input qp-fwd-host";
  targetHost.type = "text";
  targetHost.value = "127.0.0.1";
  targetHost.spellcheck = false;
  targetHost.setAttribute("aria-label", "Target host");
  const targetPort = mkPort("Target", "Target port");
  const add = document.createElement("button");
  add.type = "button";
  add.className = "qp-mini-btn qp-fwd-add-btn";
  add.textContent = "Add";
  add.addEventListener("click", () => {
    const lp = parseInt(listenPort.value, 10);
    const tp = parseInt(targetPort.value, 10);
    if (!Number.isFinite(lp) || lp < 1 || lp > 65535 || !Number.isFinite(tp) || tp < 1 || tp > 65535) {
      showToast("Ports must be numbers between 1 and 65535", "error");
      return;
    }
    invoke("ssh_forward_add", {
      id: tab.id,
      kind: kind.value,
      listenHost: "127.0.0.1",
      listenPort: lp,
      targetHost: targetHost.value.trim() || "127.0.0.1",
      targetPort: tp,
    })
      .then(() => {
        listenPort.value = "";
        targetPort.value = "";
        return refresh();
      })
      .catch((e) => showToast(`Failed to add port forward: ${e}`, "error"));
  });
  form.appendChild(kind);
  form.appendChild(listenPort);
  form.appendChild(el("span", "qp-fwd-arrow", "→"));
  form.appendChild(targetHost);
  form.appendChild(targetPort);
  form.appendChild(add);
  wrap.appendChild(form);

  refresh();
  return wrap;
}

function serialSection(tab: TerminalTab): HTMLElement {
  const sec = mkSection("Serial", "serial");
  sec.appendChild(autoReconnectRow(tab));

  sec.appendChild(mkSelectRow(
    "Baud rate",
    SERIAL_BAUD_RATES.map((b) => [String(b), String(b)] as const),
    String(tab.serialBaud ?? 115200),
    (v) => _handlers?.setSerialBaud(tab.id, parseInt(v, 10)).catch(logCatch("serial.setBaud")),
  ));
  sec.appendChild(mkSelectRow(
    "Output newlines",
    SERIAL_OUTPUT_NEWLINES,
    tab.outputNewline ?? "keep",
    (v) => _handlers?.setSerialOutputNewline(tab.id, v as SerialOutputNewline).catch(logCatch("serial.setOutputNewline")),
  ));
  sec.appendChild(mkSelectRow(
    "Enter sends",
    SERIAL_ENTER_NEWLINES,
    tab.enterNewline ?? "cr",
    (v) => _handlers?.setSerialEnterNewline(tab.id, v as SerialEnterNewline).catch(logCatch("serial.setEnterNewline")),
  ));

  // Modem lines: RTS is ours to drive, CTS is the device's answer (status).
  const rtsRow = mkToggle("RTS line", true, (on) => {
    invoke("serial_set_rts", { id: tab.id, on })
      .catch((e) => showToast(`RTS: ${e}`, "error"));
  });
  sec.appendChild(rtsRow);

  const ctsRow = el("div", "qp-row");
  ctsRow.appendChild(el("span", "qp-label", "CTS line"));
  const ctsVal = el("span", "qp-line-val", "…");
  ctsRow.appendChild(ctsVal);
  sec.appendChild(ctsRow);

  invoke<SerialLineState>("serial_line_status", { id: tab.id })
    .then((s) => {
      rtsRow.setOn(s.rts);
      ctsVal.textContent = s.cts ? "asserted" : "deasserted";
      ctsVal.classList.toggle("on", s.cts);
    })
    .catch(() => {
      ctsVal.textContent = "n/a";
    });
  return sec;
}

// -- panel frame --

function renderPanel(tab: TerminalTab): void {
  if (!panel) return;
  panel.innerHTML = "";

  const head = el("div", "qp-header");
  head.appendChild(el("span", "qp-title", tab.label));
  const state = tab.disconnected ? "disconnected" : "connected";
  head.appendChild(el("span", `qp-state qp-state-${state}`, state));
  panel.appendChild(head);

  panel.appendChild(shareSection(tab));
  if (tab.type === "ssh") panel.appendChild(sshSection(tab));
  if (tab.type === "serial") panel.appendChild(serialSection(tab));
}

export function closeQuickPanel(): void {
  panelTabId = null;
  panel?.classList.remove("open");
}

function togglePanel(): void {
  if (panelTabId !== null) {
    closeQuickPanel();
    return;
  }
  const tab = _handlers?.getActiveTab();
  const btn = qsButton();
  if (!tab || !btn || !panel) return;
  panelTabId = tab.id;
  renderPanel(tab);
  const rect = btn.getBoundingClientRect();
  panel.style.top = `${rect.bottom + 4}px`;
  panel.style.right = `${Math.max(4, window.innerWidth - rect.right)}px`;
  panel.classList.add("open");
}

// Reflect the active tab's state on the tab-bar button: red dot while the
// session is down (dead mode), blue dot while AI-shared, dimmed with no tab.
export function updateQuickButton(): void {
  const btn = qsButton();
  if (!btn) return;
  const tab = _handlers?.getActiveTab();
  btn.classList.toggle("disabled", !tab);
  btn.dataset.state = !tab ? "" : tab.disconnected ? "down" : tab.shared ? "shared" : "";
}

export function initQuickPanel(): void {
  const btn = qsButton();
  if (!btn) return;

  btn.appendChild(createElement(SlidersHorizontal, { stroke: "currentColor", width: 15, height: 15 }));
  btn.appendChild(el("span", "qs-dot"));

  panel = document.createElement("div");
  panel.className = "quick-panel";
  document.body.appendChild(panel);

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    togglePanel();
  });

  document.addEventListener("click", (e) => {
    if (panelTabId !== null && panel && !panel.contains(e.target as Node) && !btn.contains(e.target as Node)) {
      closeQuickPanel();
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && panelTabId !== null) closeQuickPanel();
  });

  // Session death/respawn: refresh the button dot, and re-render the panel
  // when it is bound to that session.
  if ("__TAURI_INTERNALS__" in window) {
    listen<{ id: string; alive: boolean }>("session-state", (e) => {
      updateQuickButton();
      if (panelTabId === e.payload.id) {
        const tab = _handlers?.getTab(e.payload.id);
        if (tab) renderPanel(tab);
      }
    }).catch(() => { });
  }

  updateQuickButton();
}
