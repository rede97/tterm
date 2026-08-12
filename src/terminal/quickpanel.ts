// Quick-status button + dropdown panel at the right end of the tab bar.
// Shows the ACTIVE tab's session state (disconnected / shared) and offers
// quick actions per session type:
//   every tab : AI share toggle (+ link copy)
//   ssh       : auto-reconnect toggle (timed retry); embedded client also
//               lists port forwards and adds new ones inline
//   serial    : profile select (built-in/custom), baud / input-mode /
//               newline selects, auto-reconnect toggle (re-plug detection),
//               flow control + modem lines (RTS/DTR drive, CTS/DSR status)
//
// Like contextmenu, this module never imports TabManager: actions go
// through handlers injected by main.ts (setQuickPanelHandlers), keeping the
// module graph acyclic. TabManager calls updateQuickButton()/closeQuickPanel()
// on switch/close/share.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { writeText as clipboardWriteText } from "@tauri-apps/plugin-clipboard-manager";
import { createElement, Zap } from "lucide";
import { allSerialProfiles, DEFAULT_SERIAL_PROFILE } from "../config/serial-profiles";
import {
  SERIAL_BAUD_RATES,
  SERIAL_ENTER_NEWLINES,
  SERIAL_OUTPUT_NEWLINE_DESCS,
  SERIAL_OUTPUT_NEWLINES,
} from "../core/common";
import { DOM_ID } from "../core/dom-ids";
import { logCatch } from "../core/errorlog";
import type {
  SerialEnterNewline,
  SerialFlowControl,
  SerialInputMode,
  SerialOutputNewline,
} from "../core/types";
import { el } from "../ui/dom";
import type { ForwardEditorValue, ForwardKind } from "../ui/forwardeditor";
import { createForwardTable } from "../ui/forwardtable";
import { showToast } from "../ui/toast";
import { addForward, listForwards, removeForward } from "./forwarding";
import type { TerminalTab } from "./tab";

// ---- Injected handlers ----

export interface QuickPanelHandlers {
  getActiveTab: () => TerminalTab | undefined;
  getTab: (tabId: string) => TerminalTab | undefined;
  shareTab: (tabId: string) => Promise<void>;
  setSerialBaud: (tabId: string, baud: number) => Promise<void>;
  setSerialProfile: (tabId: string, name: string) => Promise<void>;
  setSerialInputMode: (tabId: string, mode: SerialInputMode) => void;
  setSerialOutputNewline: (tabId: string, mode: SerialOutputNewline) => Promise<void>;
  setSerialEnterNewline: (tabId: string, mode: SerialEnterNewline) => Promise<void>;
}

let _handlers: QuickPanelHandlers | null = null;

export function setQuickPanelHandlers(h: QuickPanelHandlers): void {
  _handlers = h;
}

interface SerialLineState {
  rts: boolean;
  cts: boolean;
  dtr: boolean;
  dsr: boolean;
  // false when the port driver can't report/drive modem lines.
  supported: boolean;
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
  return document.getElementById(DOM_ID.quickStatus) as HTMLButtonElement | null;
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
  descs?: Record<string, string>,
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
    if (descs?.[value]) opt.title = descs[value];
    sel.appendChild(opt);
  }
  sel.value = current;
  row.appendChild(sel);
  if (!descs) {
    sel.addEventListener("change", () => onChange(sel.value));
    return row;
  }
  // With per-option descriptions: option hover tooltips + a live help line
  // under the row that follows the selection.
  const hint = el("div", "qp-hint qp-select-hint", descs[sel.value] ?? "");
  sel.addEventListener("change", () => {
    hint.textContent = descs[sel.value] ?? "";
    onChange(sel.value);
  });
  const wrap = el("div", "qp-select-wrap");
  wrap.appendChild(row);
  wrap.appendChild(hint);
  return wrap;
}

// -- sections --

function shareSection(tab: TerminalTab): HTMLElement {
  const sec = mkSection("AI Share", "share");
  sec.appendChild(
    mkToggle("Share this session", tab.shared, (on) => {
      const t = _handlers?.getTab(tab.id);
      if (!t) return;
      // _handlers?.shareTab is Promise|undefined (audit L1's optional-chain
      // trap); Promise.resolve normalizes both branches into one chain.
      const flip = t.shared !== on ? _handlers?.shareTab(tab.id) : undefined;
      Promise.resolve(flip)
        .then(() => {
          updateQuickButton();
          if (panelTabId === tab.id) renderPanel(t);
        })
        .catch(logCatch("quickpanel.share"));
    }),
  );
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
    invoke("session_set_auto_reconnect", { id: tab.id, enabled: on }).catch((e) =>
      showToast(`Auto-reconnect: ${e}`, "error"),
    );
  });
  invoke<boolean>("session_get_auto_reconnect", { id: tab.id })
    .then((v) => row.setOn(v))
    .catch(() => {
      /* session without reconnect support: stays off */
    });
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
  const slot = el("div", "qp-fwd-slot");
  wrap.appendChild(slot);

  // Runtime rows carry their backend forwardId so Remove can address them;
  // the table hands the same object back to onRemove.
  interface RuntimeRow extends ForwardEditorValue {
    forwardId: number;
  }

  listForwards(tab.id).then((forwards) => {
    if (!forwards) return; // toast already shown by listForwards
    const rows = forwards.map((f) => ({
      // backend kinds are exactly these three
      kind: f.kind as ForwardKind,
      listenHost: f.listenHost,
      listenPort: f.listenPort,
      targetHost: f.targetHost,
      targetPort: f.targetPort,
      forwardId: f.forwardId,
    }));
    const table = createForwardTable(rows, {
      compact: true,
      editable: false, // runtime forwards: delete + re-add instead
      onAdd: async (r) => {
        // The row pushed into the table must carry its backend forwardId —
        // onRemove needs it to address ssh_forward_remove.
        const forwardId = await addForward(tab.id, r);
        if (forwardId === null) return false;
        (r as RuntimeRow).forwardId = forwardId;
        return true;
      },
      onRemove: (r) => removeForward(tab.id, (r as RuntimeRow).forwardId),
    });
    slot.replaceChildren(table.el);
  });
  return wrap;
}

const SERIAL_INPUT_MODES: [SerialInputMode, string][] = [
  ["normal", "Normal"],
  ["echo", "Echo"],
  ["line", "Line-by-line"],
];

const SERIAL_FLOW_CONTROLS: [SerialFlowControl, string][] = [
  ["none", "None"],
  ["software", "Software (XON/XOFF)"],
  ["hardware", "Hardware (RTS/CTS)"],
];

// Profile select, grouped Built-in/Custom like the theme gallery. Applying a
// profile goes through the handler (live session apply + new global default),
// then the section re-renders so the parameter rows reflect the profile.
function serialProfileRow(tab: TerminalTab): HTMLElement {
  const row = el("div", "qp-row");
  row.appendChild(el("span", "qp-label", "Profile"));
  const sel = document.createElement("select");
  sel.className = "qp-select";
  sel.setAttribute("aria-label", "Profile");
  const profiles = allSerialProfiles();
  for (const [label, source] of [
    ["Built-in", "builtin"],
    ["Custom", "custom"],
  ] as const) {
    const group = profiles.filter((p) => p.source === source);
    if (group.length === 0) continue;
    const og = document.createElement("optgroup");
    og.label = label;
    for (const p of group) {
      const opt = document.createElement("option");
      opt.value = p.name;
      opt.textContent = p.name;
      og.appendChild(opt);
    }
    sel.appendChild(og);
  }
  sel.value = tab.serialProfile ?? DEFAULT_SERIAL_PROFILE;
  sel.addEventListener("change", () => {
    if (!_handlers) return;
    _handlers
      .setSerialProfile(tab.id, sel.value)
      .then(() => {
        if (panelTabId === tab.id) renderPanel(tab);
      })
      .catch(logCatch("serial.setProfile"));
  });
  row.appendChild(sel);
  return row;
}

// Flow control + modem signal lines. While flow !== "none" a signal block
// expands: RTS/DTR are ours to drive (toggles), CTS/DSR are the device's
// answer (read-only status). Ports whose driver can't report modem lines
// (or a failed status query) grey the whole control out.
function serialFlowBlock(tab: TerminalTab): HTMLElement {
  const wrap = el("div", "qp-flow");
  const signalWrap = el("div", "qp-signals");
  let supported = true;
  let rtsRow: ToggleRow | null = null;
  let dtrRow: ToggleRow | null = null;
  let ctsVal: HTMLElement | null = null;
  let dsrVal: HTMLElement | null = null;

  const statusRow = (label: string): [HTMLElement, HTMLElement] => {
    const row = el("div", "qp-row");
    row.appendChild(el("span", "qp-label", label));
    const val = el("span", "qp-line-val", "…");
    row.appendChild(val);
    return [row, val];
  };

  const renderSignals = (): void => {
    signalWrap.innerHTML = "";
    rtsRow = dtrRow = null;
    ctsVal = dsrVal = null;
    if (!supported || (tab.flowControl ?? "none") === "none") return;
    rtsRow = mkToggle("RTS", true, (on) => {
      invoke("serial_set_rts", { id: tab.id, on }).catch((e) => showToast(`RTS: ${e}`, "error"));
    });
    dtrRow = mkToggle("DTR", true, (on) => {
      invoke("serial_set_dtr", { id: tab.id, on }).catch((e) => showToast(`DTR: ${e}`, "error"));
    });
    signalWrap.appendChild(rtsRow);
    signalWrap.appendChild(dtrRow);
    const [ctsRow, cv] = statusRow("CTS");
    ctsVal = cv;
    signalWrap.appendChild(ctsRow);
    const [dsrRow, dv] = statusRow("DSR");
    dsrVal = dv;
    signalWrap.appendChild(dsrRow);
  };

  const applyStatus = (s: SerialLineState): void => {
    rtsRow?.setOn(s.rts);
    dtrRow?.setOn(s.dtr);
    for (const [val, on] of [
      [ctsVal, s.cts],
      [dsrVal, s.dsr],
    ] as const) {
      if (!val) continue;
      val.textContent = on ? "asserted" : "deasserted";
      val.classList.toggle("on", on);
    }
  };

  const flowRow = mkSelectRow(
    "Flow control",
    SERIAL_FLOW_CONTROLS,
    tab.flowControl ?? "none",
    (v) => {
      tab.flowControl = v;
      renderSignals();
      invoke("serial_set_flow_control", { id: tab.id, flow: v })
        .then(queryStatus)
        .catch((e) => showToast(`Flow control: ${e}`, "error"));
    },
  );
  const flowSelect = flowRow.querySelector("select")!;

  const hint = el("div", "qp-hint", "Flow control not supported by this port");
  hint.style.display = "none";

  const setSupported = (ok: boolean): void => {
    supported = ok;
    flowSelect.disabled = !ok;
    flowRow.classList.toggle("qp-disabled", !ok);
    hint.style.display = ok ? "none" : "";
    renderSignals();
  };

  function queryStatus(): void {
    invoke<SerialLineState>("serial_line_status", { id: tab.id })
      .then((s) => {
        setSupported(s.supported);
        applyStatus(s);
      })
      .catch(() => setSupported(false));
  }

  wrap.appendChild(flowRow);
  wrap.appendChild(hint);
  wrap.appendChild(signalWrap);
  renderSignals();
  queryStatus();
  return wrap;
}

// Manual release/reconnect of the port: Disconnect frees the device for
// other tools (Arduino uploads…), Reconnect re-enters through the relay's
// dead-mode respawn path. State comes from tab.disconnected (session-state
// events); the panel re-renders shortly after the action lands.
function connectionRow(tab: TerminalTab): HTMLElement {
  const row = el("div", "qp-row");
  row.appendChild(el("span", "qp-label", "Connection"));
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "qp-mini-btn qp-connect-btn";
  btn.textContent = tab.disconnected ? "Reconnect" : "Disconnect";
  btn.addEventListener("click", () => {
    const reconnecting = tab.disconnected;
    btn.disabled = true;
    invoke(reconnecting ? "serial_reconnect" : "serial_disconnect", { id: tab.id })
      .then(() =>
        setTimeout(() => {
          if (panelTabId === tab.id) renderPanel(tab);
        }, 600),
      )
      .catch((e) => {
        btn.disabled = false;
        showToast(`${reconnecting ? "Reconnect" : "Disconnect"}: ${e}`, "error");
      });
  });
  row.appendChild(btn);
  return row;
}

function serialSection(tab: TerminalTab): HTMLElement {
  const sec = mkSection("Serial", "serial");
  sec.appendChild(connectionRow(tab));
  sec.appendChild(serialProfileRow(tab));
  sec.appendChild(
    mkSelectRow(
      "Baud rate",
      SERIAL_BAUD_RATES.map((b) => [String(b), String(b)] as const),
      String(tab.serialBaud ?? 115200),
      (v) => _handlers?.setSerialBaud(tab.id, parseInt(v, 10)).catch(logCatch("serial.setBaud")),
    ),
  );
  sec.appendChild(autoReconnectRow(tab));
  // Live, session-only profile parameter tweaks (not persisted).
  sec.appendChild(
    mkSelectRow("Input mode", SERIAL_INPUT_MODES, tab.inputMode ?? "normal", (v) =>
      _handlers?.setSerialInputMode(tab.id, v as SerialInputMode),
    ),
  );
  sec.appendChild(
    mkSelectRow("Enter sends", SERIAL_ENTER_NEWLINES, tab.enterNewline ?? "cr", (v) =>
      _handlers
        ?.setSerialEnterNewline(tab.id, v as SerialEnterNewline)
        .catch(logCatch("serial.setEnterNewline")),
    ),
  );
  sec.appendChild(
    mkSelectRow(
      "Output newlines",
      SERIAL_OUTPUT_NEWLINES,
      tab.outputNewline ?? "keep",
      (v) =>
        _handlers
          ?.setSerialOutputNewline(tab.id, v as SerialOutputNewline)
          .catch(logCatch("serial.setOutputNewline")),
      SERIAL_OUTPUT_NEWLINE_DESCS,
    ),
  );
  sec.appendChild(serialFlowBlock(tab));
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

/// Hide the panel if it is bound to the given (closing) tab — a panel
/// must not outlive the tab whose session it drives.
export function closeQuickPanelForTab(tabId: string): void {
  if (panelTabId === tabId) closeQuickPanel();
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
  // Real disabled state (not just dimmed): no tab selected — or the
  // settings page is showing — means no panel to open.
  btn.disabled = !tab;
  btn.classList.toggle("disabled", !tab);
  btn.dataset.state = !tab ? "" : tab.disconnected ? "down" : tab.shared ? "shared" : "";
}

export function initQuickPanel(): void {
  const btn = qsButton();
  if (!btn) return;

  // Solid-filled bolt (fill + stroke) — reads as one bold mark at 15px.
  btn.appendChild(
    createElement(Zap, { stroke: "currentColor", fill: "currentColor", width: 15, height: 15 }),
  );
  btn.appendChild(el("span", "qs-dot"));

  panel = document.createElement("div");
  panel.className = "quick-panel";
  document.body.appendChild(panel);

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    togglePanel();
  });

  document.addEventListener("click", (e) => {
    if (
      panelTabId !== null &&
      panel &&
      !panel.contains(e.target as Node) &&
      !btn.contains(e.target as Node)
    ) {
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
    }).catch(() => {});
  }

  updateQuickButton();
}
