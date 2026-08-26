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
// Layout/visuals are a 1:1 port of docs/quickpanel-preview.html: well
// sections, custom listbox selects (no OS menu), animated switches,
// grid-rows share reveal, animated CONNECTED bar. Serial splits into
// Session / I/O / Modem lines sections (data-section: serial, serial-io,
// serial-modem).
//
// The panel body renders through lit-html: session-state events and serial
// line-status reads re-render via render(template, panel), which patches
// only the bindings that changed. Live values are read from the tab object
// (the model); async backend reads land in per-panel state and re-render.
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
  hostProp,
  SERIAL_BAUD_RATES,
  SERIAL_ENTER_NEWLINES,
  SERIAL_OUTPUT_NEWLINE_DESCS,
  SERIAL_OUTPUT_NEWLINES,
} from "../core/common";
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
import { html, nothing, render, type TemplateResult } from "../ui/lit";
import { attachOverlayScrollbar } from "../ui/overlay-scroll";
import { closeAllSelects, syncSelectTexts, type TtSelectGroup, ttSelect } from "../ui/select";
import { showToast } from "../ui/toast";
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

// -- template pieces --

function sectionTemplate(title: string, key: string, body: unknown): TemplateResult {
  return html`<div class="qp-section" data-section=${key}>
    <div class="qp-section-title">${title}</div>
    ${body}
  </div>`;
}

// Switch row (RTS/DTR, share, auto-reconnect). The visual state comes from
// the model/state on every render — async corrections are just re-renders.
// .tt-switch is the unified switch control — settings (ui/lit toggle) uses
// the same classes and transitions (docs/quickpanel-preview.html).
function qpToggle(
  label: string,
  on: boolean,
  onFlip: (on: boolean) => void,
  opts?: { disabled?: boolean },
): TemplateResult {
  const disabled = opts?.disabled ?? false;
  // Compact single-line template: e2e and tests assert the row's full
  // textContent ("RTS"), which newline/indent text nodes would break.
  return html`<div class="qp-row qp-toggle-row ${disabled ? "qp-disabled" : ""}"><span class="qp-label">${label}</span><button
      type="button"
      class="tt-switch ${on ? "on" : ""}"
      role="switch"
      aria-label=${label}
      aria-checked=${on ? "true" : "false"}
      aria-disabled=${disabled ? "true" : "false"}
      ?disabled=${disabled}
      @click=${() => {
        if (!disabled) onFlip(!on);
      }}
    ><span class="tt-knob"></span></button></div>`;
}

// The custom select lives in ui/select.ts (shared with Settings).

// Label + custom select row. With `descs`: per-option tooltips + a live
// help line under the row that follows the selection.
function qpSelectRow(
  label: string,
  options: readonly (readonly [string, string])[],
  current: string,
  onPick: (value: string) => void,
  opts?: { descs?: Record<string, string>; disabled?: boolean; rowClass?: string },
): TemplateResult {
  const row = html`<div class="qp-row ${opts?.rowClass ?? ""}">
    <span class="qp-label">${label}</span>
    ${ttSelect(label, options, current, onPick, opts)}
  </div>`;
  if (!opts?.descs) return row;
  return html`<div class="tt-select-wrap">
    ${row}
    <div class="qp-hint tt-select-hint">${opts.descs[current] ?? ""}</div>
  </div>`;
}

// -- sections --

function shareTemplate(tab: TerminalTab): TemplateResult {
  const url = tab.shared ? tab.shareUrl : undefined;
  return sectionTemplate(
    "AI Share",
    "share",
    html`
      ${qpToggle("Share this session", tab.shared, (on) => {
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
      })}
      <!-- Link row rides a grid-rows reveal (design): it stays in the DOM
           so closing/opening animates instead of popping. -->
      <div class="qp-share-reveal ${tab.shared ? "open" : ""}">
        <div class="qp-row qp-share-url-row">
          <span class="qp-share-url" title=${url ?? ""}>${url ?? ""}</span>
          <button
            type="button"
            class="tt-btn tt-btn-solid"
            @click=${(e: Event) => {
              if (!url) return;
              // In-place feedback (design): Copied for ~900ms, then back.
              const btn = e.currentTarget as HTMLButtonElement;
              clipboardWriteText(url)
                .then(() => {
                  btn.textContent = "Copied";
                  setTimeout(() => {
                    btn.textContent = "Copy";
                  }, 900);
                })
                .catch(logCatch("clipboard.write"));
            }}
            >Copy</button
          >
        </div>
      </div>
    `,
  );
}

// Auto-reconnect toggle shared by the SSH and serial sections. The backend
// retries respawn on a timer while the session is dead (for serial sessions
// a failed open simply means the device is still unplugged). The current
// flag is read once per panel binding (see renderPanel) into state.
function autoReconnectTemplate(tab: TerminalTab, st: QuickPanelState): TemplateResult {
  return qpToggle("Auto-reconnect", st.autoReconnect, (on) => {
    st.autoReconnect = on;
    renderPanel(tab);
    invoke("session_set_auto_reconnect", { id: tab.id, enabled: on }).catch((e) =>
      showToast(`Auto-reconnect: ${e}`, "error"),
    );
  });
}

function sshTemplate(tab: TerminalTab, st: QuickPanelState): TemplateResult {
  return sectionTemplate(
    "Session",
    "ssh",
    html`
      ${autoReconnectTemplate(tab, st)}
      ${
        // Mount point only — the forward table/editor are one-shot components
        // that render into the slot once per binding (loadForwards). lit-html
        // leaves the slot's unmanaged children alone across re-renders.
        tab.sshEmbedded
          ? html`<div class="qp-fwd">
              <div class="qp-sub-title">Port forwards</div>
              <div class="qp-fwd-slot"></div>
            </div>`
          : nothing
      }
    `,
  );
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
}

const SERIAL_BAUD_OPTIONS = SERIAL_BAUD_RATES.map((b) => [String(b), String(b)] as const);

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

// Manual release/reconnect of the port: Disconnect frees the device for
// other tools (Arduino uploads…), Reconnect re-enters through the relay's
// dead-mode respawn path. data-kind drives the design's CTA styling
// (Reconnect = accent; Disconnect = inset with red hover).
function connectionTemplate(tab: TerminalTab, st: QuickPanelState): TemplateResult {
  const reconnecting = tab.disconnected;
  return html`<div class="qp-row">
    <span class="qp-label">Connection</span>
    <button
      type="button"
      class="tt-btn tt-btn-solid qp-connect-btn"
      data-kind=${reconnecting ? "reconnect" : "disconnect"}
      @click=${() => {
        // Busy guard lives in the handler, not the disabled attribute: the
        // pre-lit panel re-enabled the button on every rebuild, and a click
        // landing while the button merely LOOKS ready must not no-op.
        if (st.connectBusy) return;
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
      }}
      >${reconnecting ? "Reconnect" : "Disconnect"}</button
    >
  </div>`;
}

// Session section: Connection, Profile (Built-in/Custom groups), Baud,
// Auto-reconnect. Applying a profile goes through the handler (live
// session apply + new global default), then the panel re-renders so the
// parameter rows reflect the profile.
function serialSessionTemplate(tab: TerminalTab, st: QuickPanelState): TemplateResult {
  const profiles = allSerialProfiles();
  const current = st.serialProfile ?? tab.serialProfile ?? DEFAULT_SERIAL_PROFILE;
  const groups: TtSelectGroup[] = (
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

  return sectionTemplate(
    "Session",
    "serial",
    html`
      ${connectionTemplate(tab, st)}
      <div class="qp-row">
        <span class="qp-label">Profile</span>
        ${ttSelect(
          "Profile",
          [],
          current,
          (value) => {
            st.serialProfile = value;
            if (!_handlers) return;
            _handlers
              .setSerialProfile(tab.id, value)
              .then(() => {
                if (panelTabId === tab.id) renderPanel(tab);
              })
              .catch(logCatch("serial.setProfile"));
          },
          { groups },
        )}
      </div>
      ${qpSelectRow(
        "Baud rate",
        SERIAL_BAUD_OPTIONS,
        st.baud ?? String(tab.serialBaud ?? 115200),
        (v) => {
          st.baud = v;
          _handlers
            ?.setSerialBaud(tab.id, parseInt(v, 10))
            .then(() => {
              // The header meta ("Serial · <baud> 8N1") follows the live baud.
              if (panelTabId === tab.id) renderPanel(tab);
            })
            .catch(logCatch("serial.setBaud"));
        },
      )}
      ${autoReconnectTemplate(tab, st)}
    `,
  );
}

// I/O section: live, session-only profile parameter tweaks (not persisted).
function serialIoTemplate(tab: TerminalTab, st: QuickPanelState): TemplateResult {
  return sectionTemplate(
    "I/O",
    "serial-io",
    html`
      ${qpSelectRow(
        "Input mode",
        SERIAL_INPUT_MODES,
        st.inputMode ?? tab.inputMode ?? "normal",
        (v) => {
          st.inputMode = v;
          _handlers?.setSerialInputMode(tab.id, v as SerialInputMode);
        },
      )}
      ${qpSelectRow(
        "Enter sends",
        SERIAL_ENTER_NEWLINES,
        st.enterNewline ?? tab.enterNewline ?? "cr",
        (v) => {
          st.enterNewline = v;
          _handlers
            ?.setSerialEnterNewline(tab.id, v as SerialEnterNewline)
            .catch(logCatch("serial.setEnterNewline"));
        },
      )}
      ${qpSelectRow(
        "Output newlines",
        SERIAL_OUTPUT_NEWLINES,
        st.outputNewline ?? tab.outputNewline ?? "keep",
        (v) => {
          st.outputNewline = v;
          _handlers
            ?.setSerialOutputNewline(tab.id, v as SerialOutputNewline)
            .catch(logCatch("serial.setOutputNewline"));
          // Re-render so the help line under the row follows the selection.
          renderPanel(tab);
        },
        { descs: SERIAL_OUTPUT_NEWLINE_DESCS },
      )}
    `,
  );
}

// Modem lines section. Flow control is a link setting (like baud),
// independent of the session profile. Open asserts DTR (PuTTY/Tabby/
// pyserial); RTS is left deasserted so ESP32 USB-Serial/JTAG cannot see
// RTS=1 with a DTR falling edge (the only pair that resets). Hardware
// RTS/CTS: driver owns RTS (toggle disabled, SetRts ignored); DTR stays
// software-controlled. Ports whose driver can't report/drive lines (or a
// failed status query) grey the whole control out.
function serialModemTemplate(tab: TerminalTab, st: QuickPanelState): TemplateResult {
  const flow = tab.flowControl ?? "none";
  const supported = st.linesSupported;
  const lines = st.lines;
  const hw = flow === "hardware";
  const led = (label: string, on: boolean | undefined): TemplateResult => html`
    <div class="qp-row">
      <span class="qp-label">${label}</span>
      <span class="qp-led ${on ? "on" : ""}"><i></i>${on === undefined ? "…" : on ? "high" : "low"}</span>
    </div>
  `;
  return sectionTemplate(
    "Modem lines",
    "serial-modem",
    html`
      <div class="qp-flow">
        ${qpSelectRow(
          "Flow control",
          SERIAL_FLOW_CONTROLS,
          flow,
          (v) => {
            tab.flowControl = v as SerialFlowControl;
            renderPanel(tab);
            invoke("serial_set_flow_control", { id: tab.id, flow: v })
              .then(() => queryLineStatus(tab, st))
              .catch((e) => showToast(`Flow control: ${e}`, "error"));
          },
          { disabled: !supported, rowClass: supported ? "" : "qp-disabled" },
        )}
        <div class="qp-hint" style=${supported ? "display:none" : ""}>
          Flow control not supported by this port
        </div>
        <div class="qp-signals">
          ${
            supported
              ? html`
                ${qpToggle(
                  "RTS",
                  hw ? true : (lines?.rts ?? false),
                  (on) => {
                    if (st.lines) st.lines = { ...st.lines, rts: on };
                    renderPanel(tab);
                    invoke("serial_set_rts", { id: tab.id, on }).catch((e) =>
                      showToast(`RTS: ${e}`, "error"),
                    );
                  },
                  { disabled: hw },
                )}
                ${led("CTS", lines?.cts)}
                ${qpToggle("DTR", lines?.dtr ?? false, (on) => {
                  if (st.lines) st.lines = { ...st.lines, dtr: on };
                  renderPanel(tab);
                  invoke("serial_set_dtr", { id: tab.id, on }).catch((e) =>
                    showToast(`DTR: ${e}`, "error"),
                  );
                })}
                ${led("DSR", lines?.dsr)}
              `
              : nothing
          }
        </div>
        <div class="qp-hint" style=${supported && hw ? "" : "display:none"}>
          RTS is driver-managed under hardware flow control; DTR stays software-controlled
        </div>
      </div>
    `,
  );
}

// -- panel frame --

function metaFor(tab: TerminalTab): string {
  if (tab.type === "ssh") {
    const h = tab.sshHost;
    const target = h ? `${hostProp(h, "user") || "root"}@${hostProp(h, "hostname") || h.name}` : "";
    return target ? `SSH · ${target}` : "SSH";
  }
  if (tab.type === "serial") return `Serial · ${tab.serialBaud ?? 115200} 8N1`;
  return "Local shell";
}

function panelTemplate(tab: TerminalTab, st: QuickPanelState): TemplateResult {
  const conn = tab.disconnected ? "disconnected" : "connected";
  return html`
    <div class="qp-header">
      <div class="qp-ident">
        <span class="qp-title">${tab.label}</span>
        <span class="qp-meta">${metaFor(tab)}</span>
      </div>
      <div class="qp-badges">
        <span
          class="qp-sharing ${tab.shared ? "on" : ""}"
          title=${tab.shared ? "AI share on" : "AI share off"}
          >SHARING</span
        >
        <span class="qp-conn qp-conn-${conn}" data-conn=${conn}>${conn.toUpperCase()}</span>
      </div>
    </div>
    ${shareTemplate(tab)}
    ${tab.type === "ssh" ? sshTemplate(tab, st) : nothing}
    ${tab.type === "serial" ? serialSessionTemplate(tab, st) : nothing}
    ${tab.type === "serial" ? serialIoTemplate(tab, st) : nothing}
    ${tab.type === "serial" ? serialModemTemplate(tab, st) : nothing}
  `;
}

function renderPanel(tab: TerminalTab): void {
  if (!panel) return;
  const st = stateFor(tab);
  render(panelTemplate(tab, st), panel);
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
      // session without reconnect support: stays off
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
      // A failed status query means the driver can't report modem lines.
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
  // Real disabled state (not just dimmed): no tab selected — or the
  // settings page is showing — means no panel to open.
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

  // Solid-filled bolt (fill + stroke) — reads as one bold mark at 15px.
  btn.appendChild(
    createElement(Zap, { stroke: "currentColor", fill: "currentColor", width: 15, height: 15 }),
  );
  btn.appendChild(el("span", "qs-dot"));

  panel = document.createElement("div");
  panel.className = "quick-panel";
  document.body.appendChild(panel);
  // Q8b: floating thumb — a classic bar would squeeze the 148px column.
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
      // An open select menu collapses on any outside click, even inside
      // the panel (design behavior).
      if (target instanceof Node) {
        const inSelect = target instanceof Element ? target.closest(".tt-select") : null;
        if (!inSelect) closeAllSelects();
      }
    }
  });
  document.addEventListener("keydown", (e) => {
    // Design (quickpanel-preview): Escape closes an open select dropdown
    // only — the panel itself stays open (a select's own handler already
    // stopPropagations; this catches focus elsewhere in the panel).
    if (e.key === "Escape") closeAllSelects();
  });

  // Session death/respawn: refresh the button dot, and re-render the panel
  // when it is bound to that session.
  if ("__TAURI_INTERNALS__" in window) {
    // Listener registration is best-effort; the panel works without it.
    listen<{ id: string; alive: boolean }>("session-state", (e) => {
      updateQuickButton();
      if (panelTabId === e.payload.id) {
        const tab = _handlers?.getTab(e.payload.id);
        if (tab) {
          // The connect/disconnect round-trip is complete once the session
          // state actually flipped — clear the busy guard so the button is
          // genuinely clickable (the 600ms timer below is only a fallback).
          if (panelState && panelState.tabId === tab.id) panelState.connectBusy = false;
          renderPanel(tab);
        }
      }
    }).catch(swallow);
  }

  updateQuickButton();
}
