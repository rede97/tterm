// Pure quick-panel lit views — shared by app (terminal/quickpanel.ts) and
// drafts/quickpanel-preview.html. Input is a plain view-model + action
// callbacks; no TerminalTab, invoke, or TabManager.

import {
  SERIAL_BAUD_RATES,
  SERIAL_ENTER_NEWLINES,
  SERIAL_FRAMES,
  SERIAL_OUTPUT_NEWLINE_DESCS,
  SERIAL_OUTPUT_NEWLINES,
} from "../../../core/common";
import { html, nothing, type TemplateResult } from "../../lit";
import { type TtSelectGroup, ttSelect } from "../../select";

export type QpConn = "connected" | "disconnected";
export type QpKind = "local" | "ssh" | "serial";

export interface QpLinesModel {
  rts: boolean;
  cts: boolean | undefined;
  dtr: boolean;
  dsr: boolean | undefined;
}

export interface QpPanelModel {
  kind: QpKind;
  title: string;
  meta: string;
  conn: QpConn;
  shared: boolean;
  shareUrl?: string;
  autoReconnect?: boolean;
  /** Embedded SSH client — show port-forwards slot. */
  sshEmbedded?: boolean;
  /** Serial: disconnected → Reconnect CTA. */
  reconnecting?: boolean;
  connectBusy?: boolean;
  serialProfile?: string;
  profileGroups?: TtSelectGroup[];
  baud?: string;
  /** Link frame 8N1 / 8E1 / 8O1. */
  frame?: string;
  inputMode?: string;
  enterNewline?: string;
  outputNewline?: string;
  flow?: string;
  linesSupported?: boolean;
  lines?: QpLinesModel | null;
}

export interface QpPanelActions {
  onShare?: (on: boolean) => void;
  onCopyShareUrl?: (url: string, btn: HTMLButtonElement) => void;
  onAutoReconnect?: (on: boolean) => void;
  onConnectToggle?: () => void;
  onProfile?: (value: string) => void;
  onBaud?: (value: string) => void;
  onFrame?: (value: string) => void;
  onInputMode?: (value: string) => void;
  onEnterNewline?: (value: string) => void;
  onOutputNewline?: (value: string) => void;
  onFlow?: (value: string) => void;
  onRts?: (on: boolean) => void;
  onDtr?: (on: boolean) => void;
}

export const QP_SERIAL_BAUD_OPTIONS = SERIAL_BAUD_RATES.map((b) => [String(b), String(b)] as const);

export const QP_SERIAL_FRAME_OPTIONS = SERIAL_FRAMES;

export const QP_SERIAL_INPUT_MODES = [
  ["normal", "Normal"],
  ["echo", "Echo"],
  ["line", "Line-by-line"],
] as const;

export const QP_SERIAL_FLOW_CONTROLS = [
  ["none", "None"],
  ["software", "Software (XON/XOFF)"],
  ["hardware", "Hardware (RTS/CTS)"],
] as const;

function sectionTemplate(title: string, key: string, body: unknown): TemplateResult {
  return html`<div class="qp-section" data-section=${key}>
    <div class="qp-section-title">${title}</div>
    ${body}
  </div>`;
}

export function qpToggle(
  label: string,
  on: boolean,
  onFlip: (on: boolean) => void,
  opts?: { disabled?: boolean },
): TemplateResult {
  const disabled = opts?.disabled ?? false;
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

export function qpSelectRow(
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

function qpLed(label: string, on: boolean | undefined): TemplateResult {
  return html`
    <div class="qp-row">
      <span class="qp-label">${label}</span>
      <span class="qp-led ${on ? "on" : ""}"><i></i>${on === undefined ? "…" : on ? "high" : "low"}</span>
    </div>
  `;
}

function shareSection(m: QpPanelModel, a: QpPanelActions): TemplateResult {
  const url = m.shared ? m.shareUrl : undefined;
  return sectionTemplate(
    "AI Share",
    "share",
    html`
      ${qpToggle("Share this session", m.shared, (on) => a.onShare?.(on))}
      <div class="qp-share-reveal ${m.shared ? "open" : ""}">
        <div class="qp-row qp-share-url-row">
          <span class="qp-share-url" title=${url ?? ""}>${url ?? ""}</span>
          <button
            type="button"
            class="tt-btn tt-btn-solid"
            @click=${(e: Event) => {
              if (!url) return;
              a.onCopyShareUrl?.(url, e.currentTarget as HTMLButtonElement);
            }}
            >Copy</button
          >
        </div>
      </div>
    `,
  );
}

function sshSection(m: QpPanelModel, a: QpPanelActions): TemplateResult {
  return sectionTemplate(
    "Session",
    "ssh",
    html`${qpToggle("Auto-reconnect", m.autoReconnect ?? false, (on) => a.onAutoReconnect?.(on))}`,
  );
}

function forwardsSection(): TemplateResult {
  return sectionTemplate(
    "Port forwards",
    "forwards",
    html`<div class="qp-fwd-slot"></div>`,
  );
}

function serialSessionSection(m: QpPanelModel, a: QpPanelActions): TemplateResult {
  const reconnecting = m.reconnecting ?? false;
  const groups = m.profileGroups ?? [];
  const current = m.serialProfile ?? "Normal";
  return sectionTemplate(
    "Session",
    "serial",
    html`
      ${qpToggle("Auto-reconnect", m.autoReconnect ?? false, (on) => a.onAutoReconnect?.(on))}
      <div class="qp-row">
        <span class="qp-label">Connection</span>
        <button
          type="button"
          class="tt-btn tt-btn-solid qp-connect-btn"
          data-kind=${reconnecting ? "reconnect" : "disconnect"}
          @click=${() => {
            if (m.connectBusy) return;
            a.onConnectToggle?.();
          }}
          >${reconnecting ? "Reconnect" : "Disconnect"}</button
        >
      </div>
      <div class="qp-row">
        <span class="qp-label">Profile</span>
        ${ttSelect("Profile", [], current, (value) => a.onProfile?.(value), { groups })}
      </div>
      ${qpSelectRow("Baud rate", QP_SERIAL_BAUD_OPTIONS, m.baud ?? "115200", (v) => a.onBaud?.(v))}
      ${qpSelectRow("Frame", QP_SERIAL_FRAME_OPTIONS, m.frame ?? "8N1", (v) => a.onFrame?.(v))}
    `,
  );
}

function serialIoSection(m: QpPanelModel, a: QpPanelActions): TemplateResult {
  return sectionTemplate(
    "I/O",
    "serial-io",
    html`
      ${qpSelectRow("Input mode", QP_SERIAL_INPUT_MODES, m.inputMode ?? "normal", (v) =>
        a.onInputMode?.(v),
      )}
      ${qpSelectRow("Enter sends", SERIAL_ENTER_NEWLINES, m.enterNewline ?? "cr", (v) =>
        a.onEnterNewline?.(v),
      )}
      ${qpSelectRow(
        "Output newlines",
        SERIAL_OUTPUT_NEWLINES,
        m.outputNewline ?? "keep",
        (v) => a.onOutputNewline?.(v),
        { descs: SERIAL_OUTPUT_NEWLINE_DESCS },
      )}
    `,
  );
}

/** Modem lines — hardware flow greys RTS only; no explanatory hint copy. */
export function qpModemSection(m: QpPanelModel, a: QpPanelActions): TemplateResult {
  const flow = m.flow ?? "none";
  const supported = m.linesSupported ?? true;
  const lines = m.lines;
  const hw = flow === "hardware";
  return sectionTemplate(
    "Modem lines",
    "serial-modem",
    html`
      <div class="qp-flow">
        ${qpSelectRow("Flow control", QP_SERIAL_FLOW_CONTROLS, flow, (v) => a.onFlow?.(v), {
          disabled: !supported,
          rowClass: supported ? "" : "qp-disabled",
        })}
        <div class="qp-hint" style=${supported ? "display:none" : ""}>
          Flow control not supported by this port
        </div>
        <div class="qp-signals">
          ${
            supported
              ? html`
                ${qpToggle("RTS", hw ? true : (lines?.rts ?? false), (on) => a.onRts?.(on), {
                  disabled: hw,
                })}
                ${qpLed("CTS", lines?.cts)}
                ${qpToggle("DTR", lines?.dtr ?? false, (on) => a.onDtr?.(on))}
                ${qpLed("DSR", lines?.dsr)}
              `
              : nothing
          }
        </div>
      </div>
    `,
  );
}

export function qpPanelView(m: QpPanelModel, a: QpPanelActions = {}): TemplateResult {
  return html`
    <div class="qp-header">
      <div class="qp-ident">
        <span class="qp-title">${m.title}</span>
        <span class="qp-meta">${m.meta}</span>
      </div>
      <div class="qp-badges">
        <span
          class="qp-sharing ${m.shared ? "on" : ""}"
          title=${m.shared ? "AI share on" : "AI share off"}
          >SHARING</span
        >
        <span class="qp-conn qp-conn-${m.conn}" data-conn=${m.conn}>${m.conn.toUpperCase()}</span>
      </div>
    </div>
    ${shareSection(m, a)}
    ${m.kind === "ssh" ? sshSection(m, a) : nothing}
    ${m.kind === "ssh" && m.sshEmbedded ? forwardsSection() : nothing}
    ${m.kind === "serial" ? serialSessionSection(m, a) : nothing}
    ${m.kind === "serial" ? serialIoSection(m, a) : nothing}
    ${m.kind === "serial" ? qpModemSection(m, a) : nothing}
  `;
}
