// Quick-status button + dropdown panel at the right end of the tab bar.
// Shows the ACTIVE tab's session state (connection pill / sharing pill)
// and offers quick actions per session type:
//   every tab : AI share toggle (+ animated link reveal, copy)
//   ssh       : auto-reconnect toggle (timed retry); embedded client also
//               lists port forwards and adds new ones inline
//   serial    : profile / baud / input-mode / newline selects, auto-
//               reconnect toggle, flow control + modem lines (RTS/DTR
//               drive, CTS/DSR status)
//
// Product DOM is rendered by the shared pure view in ui/kit/qp/view.ts
// (same module as docs/quickpanel-preview.html). This file maps tab +
// panel state → view-model and wires IPC / handlers.
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
import { hostProp } from "../core/common";
import { DOM_ID } from "../core/dom-ids";
import { logCatch, swallow } from "../core/errorlog";
import type {
  SerialEnterNewline,
  SerialFlowControl,
  SerialInputMode,
  SerialOutputNewline,
} from "../core/types";
import { el } from "../ui/dom";
import type { ForwardEditorValue, ForwardKind } from "../ui/forwardeditor";
import { addForward, listForwards, removeForward } from "../ui/forwarding";
import { createForwardTable } from "../ui/forwardtable";
import { type QpPanelActions, type QpPanelModel, qpPanelView } from "../ui/kit/qp/view";
import { render } from "../ui/lit";
import { attachOverlayScrollbar } from "../ui/overlay-scroll";
import { dismissChromePopups, registerChromePopup } from "../ui/popups";
import { closeAllSelects, syncSelectTexts, type TtSelectGroup } from "../ui/select";
import { showToast } from "../ui/toast";
import type { TerminalTab } from "./tab";

// ---- Injected handlers ----

export interface QuickPanelHandlers {
  getActiveTab: () => TerminalTab | undefined;
  getTab: (tabId: string) => TerminalTab | undefined;
  shareTab: (tabId: string) => Promise<void>;
  setSerialBaud: (tabId: string, baud: number) => Promise<void>;
  setSerialFrame: (tabId: string, frame: string) => Promise<void>;
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

// ---- Per-panel state ----
// The tab object is the model; this holds only what the tab can't provide:
// async backend reads and in-flight serial select values (a re-render must
// never revert a select the user just flipped before its handler landed).

interface QuickPanelState {
  // Tab this state belongs to — the state resets when the panel rebinds.
  tabId: string;
  // Auto-reconnect flag, corrected asynchronously by session_get_auto_reconnect.
  autoReconnect: boolean;
  autoReconnectQueried: boolean;
  // Modem line status; null until the first serial_line_status answer lands.
  lines: SerialLineState | null;
  linesSupported: boolean;
  linesQueried: boolean;
  // Connect/disconnect round-trip in flight (button disabled meanwhile).
  connectBusy: boolean;
  forwardsQueried: boolean;
  // In-flight serial select values, shadowing the tab until handlers land.
  serialProfile: string | null;
  baud: string | null;
  frame: string | null;
  inputMode: string | null;
  enterNewline: string | null;
  outputNewline: string | null;
}

let panel: HTMLElement | null = null;
// The tab the open panel is bound to; null while closed.
let panelTabId: string | null = null;
let panelState: QuickPanelState | null = null;

function stateFor(tab: TerminalTab): QuickPanelState {
  if (!panelState || panelState.tabId !== tab.id) {
    panelState = {
      tabId: tab.id,
      autoReconnect: false,
      autoReconnectQueried: false,
      lines: null,
      linesSupported: true,
      linesQueried: false,
      connectBusy: false,
      forwardsQueried: false,
      serialProfile: null,
      baud: null,
      frame: null,
      inputMode: null,
      enterNewline: null,
      outputNewline: null,
    };
  }
  return panelState;
}

function qsButton(): HTMLButtonElement | null {
  return document.getElementById(DOM_ID.quickStatus) as HTMLButtonElement | null;
}

function metaFor(tab: TerminalTab): string {
  if (tab.type === "ssh") {
    const h = tab.sshHost;
    const target = h ? `${hostProp(h, "user") || "root"}@${hostProp(h, "hostname") || h.name}` : "";
    return target ? `SSH · ${target}` : "SSH";
  }
  if (tab.type === "serial") {
    return `Serial · ${tab.serialBaud ?? 115200} ${tab.serialFrame ?? "8N1"}`;
  }
  return "Local shell";
}

function profileGroups(): TtSelectGroup[] {
  const profiles = allSerialProfiles();
  return (
    [
      ["Built-in", "builtin"],
      ["Custom", "custom"],
    ] as const
  )
    .map(([label, source]) => ({
      label,
      items: profiles.filter((p) => p.source === source).map((p) => [p.name, p.name] as const),
    }))
    .filter((g) => g.items.length > 0);
}

function toModel(tab: TerminalTab, st: QuickPanelState): QpPanelModel {
  const kind = tab.type === "ssh" || tab.type === "serial" ? tab.type : "local";
  const lines = st.lines;
  // Serial: port name only in the header — baud/parity live in `.qp-meta`.
  const title =
    kind === "serial" ? tab.serialPortName || tab.label.split(" · ")[0] || tab.label : tab.label;
  return {
    kind,
    title,
    meta: metaFor(tab),
    conn: tab.disconnected ? "disconnected" : "connected",
    shared: tab.shared,
    shareUrl: tab.shareUrl,
    autoReconnect: st.autoReconnect,
    sshEmbedded: tab.sshEmbedded,
    reconnecting: tab.disconnected,
    connectBusy: st.connectBusy,
    serialProfile: st.serialProfile ?? tab.serialProfile ?? DEFAULT_SERIAL_PROFILE,
    profileGroups: kind === "serial" ? profileGroups() : undefined,
    baud: st.baud ?? String(tab.serialBaud ?? 115200),
    frame: st.frame ?? tab.serialFrame ?? "8N1",
    inputMode: st.inputMode ?? tab.inputMode ?? "normal",
    enterNewline: st.enterNewline ?? tab.enterNewline ?? "cr",
    outputNewline: st.outputNewline ?? tab.outputNewline ?? "keep",
    flow: tab.flowControl ?? "none",
    linesSupported: st.linesSupported,
    lines: lines ? { rts: lines.rts, cts: lines.cts, dtr: lines.dtr, dsr: lines.dsr } : null,
  };
}

function actionsFor(tab: TerminalTab, st: QuickPanelState): QpPanelActions {
  return {
    onShare: (on) => {
      const t = _handlers?.getTab(tab.id);
      if (!t) return;
      const flip = t.shared !== on ? _handlers?.shareTab(tab.id) : undefined;
      Promise.resolve(flip)
        .then(() => {
          updateQuickButton();
          if (panelTabId === tab.id) renderPanel(t);
        })
        .catch(logCatch("quickpanel.share"));
    },
    onCopyShareUrl: (url, btn) => {
      clipboardWriteText(url)
        .then(() => {
          btn.textContent = "Copied";
          setTimeout(() => {
            btn.textContent = "Copy";
          }, 900);
        })
        .catch(logCatch("clipboard.write"));
    },
    onAutoReconnect: (on) => {
      st.autoReconnect = on;
      renderPanel(tab);
      invoke("session_set_auto_reconnect", { id: tab.id, enabled: on }).catch((e) =>
        showToast(`Auto-reconnect: ${e}`, "error"),
      );
    },
    onConnectToggle: () => {
      if (st.connectBusy) return;
      const reconnecting = tab.disconnected;
      st.connectBusy = true;
      renderPanel(tab);
      invoke(reconnecting ? "serial_reconnect" : "serial_disconnect", { id: tab.id })
        .then(() =>
          setTimeout(() => {
            if (panelState === st) st.connectBusy = false;
            if (panelTabId === tab.id) renderPanel(tab);
          }, 600),
        )
        .catch((e) => {
          st.connectBusy = false;
          if (panelTabId === tab.id) renderPanel(tab);
          showToast(`${reconnecting ? "Reconnect" : "Disconnect"}: ${e}`, "error");
        });
    },
    onProfile: (value) => {
      st.serialProfile = value;
      if (!_handlers) return;
      _handlers
        .setSerialProfile(tab.id, value)
        .then(() => {
          if (panelTabId === tab.id) renderPanel(tab);
        })
        .catch(logCatch("serial.setProfile"));
    },
    onBaud: (v) => {
      st.baud = v;
      _handlers
        ?.setSerialBaud(tab.id, parseInt(v, 10))
        .then(() => {
          if (panelTabId === tab.id) renderPanel(tab);
        })
        .catch(logCatch("serial.setBaud"));
    },
    onFrame: (v) => {
      st.frame = v;
      _handlers?.setSerialFrame(tab.id, v).catch(logCatch("serial.setFrame"));
      renderPanel(tab);
    },
    onInputMode: (v) => {
      st.inputMode = v;
      _handlers?.setSerialInputMode(tab.id, v as SerialInputMode);
    },
    onEnterNewline: (v) => {
      st.enterNewline = v;
      _handlers
        ?.setSerialEnterNewline(tab.id, v as SerialEnterNewline)
        .catch(logCatch("serial.setEnterNewline"));
    },
    onOutputNewline: (v) => {
      st.outputNewline = v;
      _handlers
        ?.setSerialOutputNewline(tab.id, v as SerialOutputNewline)
        .catch(logCatch("serial.setOutputNewline"));
      renderPanel(tab);
    },
    onFlow: (v) => {
      tab.flowControl = v as SerialFlowControl;
      renderPanel(tab);
      invoke("serial_set_flow_control", { id: tab.id, flow: v })
        .then(() => queryLineStatus(tab, st))
        .catch((e) => showToast(`Flow control: ${e}`, "error"));
    },
    onRts: (on) => {
      if (st.lines) st.lines = { ...st.lines, rts: on };
      renderPanel(tab);
      invoke("serial_set_rts", { id: tab.id, on }).catch((e) => showToast(`RTS: ${e}`, "error"));
    },
    onDtr: (on) => {
      if (st.lines) st.lines = { ...st.lines, dtr: on };
      renderPanel(tab);
      invoke("serial_set_dtr", { id: tab.id, on }).catch((e) => showToast(`DTR: ${e}`, "error"));
    },
  };
}

function loadForwards(tab: TerminalTab): void {
  // Runtime rows carry their backend forwardId so Remove can address them;
  // the table hands the same object back to onRemove.
  interface RuntimeRow extends ForwardEditorValue {
    forwardId: number;
  }

  listForwards(tab.id).then((forwards) => {
    if (!forwards) return; // toast already shown by listForwards
    if (panelTabId !== tab.id || !panel) return; // panel closed/rebound meanwhile
    const slot = panel.querySelector(".qp-fwd-slot");
    if (!slot) return;
    const rows = forwards.map((f) => ({
      kind: f.kind as ForwardKind,
      listenHost: f.listenHost,
      listenPort: f.listenPort,
      targetHost: f.targetHost,
      targetPort: f.targetPort,
      forwardId: f.forwardId,
    }));
    const table = createForwardTable(rows, {
      editable: false,
      onAdd: async (r) => {
        const forwardId = await addForward(tab.id, r);
        if (forwardId === null) return false;
        (r as RuntimeRow).forwardId = forwardId;
        return true;
      },
      onRemove: (r) => removeForward(tab.id, (r as RuntimeRow).forwardId),
    });
    slot.replaceChildren(table.el);
  });
}

function renderPanel(tab: TerminalTab): void {
  if (!panel) return;
  const st = stateFor(tab);
  render(qpPanelView(toModel(tab, st), actionsFor(tab, st)), panel);
  syncSelectTexts(panel);
  // Async backend state reads, fired once per panel binding; their answers
  // land in state and re-render. Explicit re-reads (flow control change,
  // reconnect) reset the relevant flag first.
  if ((tab.type === "ssh" || tab.type === "serial") && !st.autoReconnectQueried) {
    st.autoReconnectQueried = true;
    invoke<boolean>("session_get_auto_reconnect", { id: tab.id })
      .then((v) => {
        if (panelTabId !== tab.id || panelState !== st) return;
        st.autoReconnect = v;
        renderPanel(tab);
      })
      .catch(swallow);
  }
  if (tab.type === "serial" && !st.linesQueried) {
    st.linesQueried = true;
    queryLineStatus(tab, st);
  }
  if (tab.type === "ssh" && tab.sshEmbedded && !st.forwardsQueried) {
    st.forwardsQueried = true;
    loadForwards(tab);
  }
}

function queryLineStatus(tab: TerminalTab, st: QuickPanelState): void {
  invoke<SerialLineState>("serial_line_status", { id: tab.id })
    .then((s) => {
      if (panelTabId !== tab.id || panelState !== st) return;
      st.lines = s;
      st.linesSupported = s.supported;
      renderPanel(tab);
    })
    .catch(() => {
      if (panelTabId !== tab.id || panelState !== st) return;
      st.lines = null;
      st.linesSupported = false;
      renderPanel(tab);
    });
}

export function closeQuickPanel(): void {
  panelTabId = null;
  panel?.classList.remove("open");
  closeAllSelects();
}

registerChromePopup("quick", closeQuickPanel);

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
  dismissChromePopups("quick");
  panelTabId = tab.id;
  panelState = null; // fresh per open: async reads re-fire, shadows reset
  renderPanel(tab);
  const rect = btn.getBoundingClientRect();
  panel.style.top = `${rect.bottom + 4}px`;
  panel.style.right = `${Math.max(4, window.innerWidth - rect.right)}px`;
  panel.classList.add("open");
}

// Reflect the active tab's state on the tab-bar button: red dot while the
// session is down (dead mode), blue bolt while AI-shared, dimmed with no
// tab (design: sharing recolors the bolt itself — no separate dot).
// The accessible name tracks the same state (P1-03).
export function updateQuickButton(): void {
  const btn = qsButton();
  if (!btn) return;
  const tab = _handlers?.getActiveTab();
  btn.disabled = !tab;
  btn.classList.toggle("disabled", !tab);
  btn.dataset.state = !tab ? "" : tab.disconnected ? "down" : tab.shared ? "shared" : "";
  const state = !tab
    ? "no active session"
    : tab.disconnected
      ? "disconnected"
      : tab.shared
        ? "sharing with AI"
        : "connected";
  const name = tab
    ? `Session quick actions: ${tab.label}, ${state}`
    : `Session quick actions, ${state}`;
  btn.setAttribute("aria-label", name);
  btn.title = name;
}

export function initQuickPanel(): void {
  const btn = qsButton();
  if (!btn) return;

  btn.appendChild(
    createElement(Zap, { stroke: "currentColor", fill: "currentColor", width: 15, height: 15 }),
  );
  btn.appendChild(el("span", "qs-dot"));

  panel = document.createElement("div");
  panel.className = "quick-panel";
  document.body.appendChild(panel);
  attachOverlayScrollbar(panel);

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    togglePanel();
  });

  document.addEventListener("click", (e) => {
    if (panelTabId !== null && panel) {
      const target = e.target;
      if (target instanceof Node && !panel.contains(target) && !btn.contains(target)) {
        closeQuickPanel();
      }
      if (target instanceof Node) {
        const inSelect = target instanceof Element ? target.closest(".tt-select") : null;
        if (!inSelect) closeAllSelects();
      }
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeAllSelects();
  });

  if ("__TAURI_INTERNALS__" in window) {
    listen<{ id: string; alive: boolean }>("session-state", (e) => {
      updateQuickButton();
      if (panelTabId === e.payload.id) {
        const tab = _handlers?.getTab(e.payload.id);
        if (tab) {
          if (panelState && panelState.tabId === tab.id) panelState.connectBusy = false;
          renderPanel(tab);
        }
      }
    }).catch(swallow);
  }

  updateQuickButton();
}
