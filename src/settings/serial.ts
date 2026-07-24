// Settings — Serial panel
// Serial port defaults, connected ports, parameter history

import { configStore, type ConfigState } from "../core/store";
import type { SerialInputMode, SerialOutputNewline, SerialEnterNewline } from "../core/types";
import { SERIAL_BAUD_RATES, SERIAL_OUTPUT_NEWLINES, SERIAL_ENTER_NEWLINES } from "../core/common";
import { loadSerialPorts } from "../config/wt-profiles";
import { serialKeyFor, rememberSerialParams, forgetSerialParams } from "../config/serial-memory";
import { showToast } from "../ui/toast";

export function createSerialPanel(): HTMLElement {
  const panel = document.createElement("div");
  panel.className = "settings-panel-content";
  panel.dataset.panel = "serial";
  panel.style.display = "none";
  renderSerialPanel(panel);
  return panel;
}

export function refreshSerialPanel(root: HTMLElement): void {
  renderSerialPanel(root);
}

function baudOptionsHtml(current: number): string {
  return SERIAL_BAUD_RATES.map(b =>
    `<option value="${b}" ${current === b ? "selected" : ""}>${b}</option>`).join("");
}

function inputModeOptionsHtml(current: SerialInputMode): string {
  const modes: [SerialInputMode, string][] = [["normal", "Normal"], ["echo", "Echo"], ["line", "Line by Line"]];
  return modes.map(([v, label]) =>
    `<option value="${v}" ${current === v ? "selected" : ""}>${label}</option>`).join("");
}

function enterNewlineOptionsHtml(current: string): string {
  return SERIAL_ENTER_NEWLINES.map(([v, label]) =>
    `<option value="${v}" ${current === v ? "selected" : ""}>${label}</option>`).join("");
}

function outputNewlineOptionsHtml(current: string): string {
  return SERIAL_OUTPUT_NEWLINES.map(([v, label]) =>
    `<option value="${v}" ${current === v ? "selected" : ""}>${label}</option>`).join("");
}

function renderSerialPanel(container: HTMLElement) {
  container.innerHTML = `
    <div class="settings-section">
      <div class="settings-section-title">Defaults</div>
      <div class="settings-item settings-item-row">
        <div class="settings-item-info">
          <div class="settings-item-title">Default baud rate</div>
          <div class="settings-item-desc">Baud rate for ports without remembered settings (8N1, no flow control).</div>
        </div>
        <div class="settings-item-control">
          <select id="set-serial-baud" class="settings-select">${baudOptionsHtml(configStore.get("serialBaud"))}</select>
        </div>
      </div>
      <div class="settings-item settings-item-row">
        <div class="settings-item-info">
          <div class="settings-item-title">Default input mode</div>
          <div class="settings-item-desc">Normal: send keys directly. ECHO: also echo locally. Line by Line: edit locally, send whole line on Enter.</div>
        </div>
        <div class="settings-item-control">
          <select id="set-serial-input-mode" class="settings-select">${inputModeOptionsHtml(configStore.get("serialInputMode"))}</select>
        </div>
      </div>
      <div class="settings-item settings-item-row">
        <div class="settings-item-info">
          <div class="settings-item-title">Default output newlines</div>
          <div class="settings-item-desc">How device output line endings are rewritten before display.</div>
        </div>
        <div class="settings-item-control">
          <select id="set-serial-output-newline" class="settings-select">${outputNewlineOptionsHtml(configStore.get("serialOutputNewline"))}</select>
        </div>
      </div>
      <div class="settings-item settings-item-row">
        <div class="settings-item-info">
          <div class="settings-item-title">Enter sends</div>
          <div class="settings-item-desc">Line terminator sent when pressing Enter (AT-command devices usually want CRLF).</div>
        </div>
        <div class="settings-item-control">
          <select id="set-serial-enter-newline" class="settings-select">${enterNewlineOptionsHtml(configStore.get("serialEnterNewline"))}</select>
        </div>
      </div>
    </div>
    <div class="settings-section">
      <div class="settings-section-title">Connected Ports</div>
      <div id="serial-port-list">
        <div class="settings-item-desc">Enumerating\u2026</div>
      </div>
    </div>
    <div class="settings-section">
      <div class="settings-section-title">History</div>
      <div id="serial-history-list"></div>
    </div>
  `;

  const listEl = container.querySelector("#serial-port-list")!;
  const historyEl = container.querySelector("#serial-history-list")!;

  const renderHistory = () => {
    const serialPortParams = configStore.get("serialPortParams");
    const keys = Object.keys(serialPortParams);
    if (keys.length === 0) {
      historyEl.innerHTML = `<div class="settings-item-desc">No remembered port settings.</div>`;
      return;
    }
    historyEl.innerHTML = keys.map(key => {
      const p = serialPortParams[key];
      const label = key.startsWith("usb:") ? `USB ${key.slice(4)}` : key.slice(4);
      return `
        <div class="settings-item settings-item-row serial-history-row" data-key="${esc(key)}">
          <div class="settings-item-info">
            <div class="settings-item-title">${esc(label)}</div>
            <div class="settings-item-desc">${p.baud} baud \u00b7 ${esc(p.inputMode ?? "normal")} \u00b7 ${esc(p.outputNewline ?? "keep")}</div>
          </div>
          <div class="settings-item-control">
            <button class="settings-link-btn serial-history-forget" data-key="${esc(key)}">Forget</button>
          </div>
        </div>`;
    }).join("");
    historyEl.querySelectorAll<HTMLButtonElement>(".serial-history-forget").forEach(btn => {
      btn.addEventListener("click", async () => {
        await forgetSerialParams(btn.dataset.key!);
        renderHistory();
        showToast(`Forgot ${btn.dataset.key}`, "info", 1500);
      });
    });
  };
  renderHistory();

  loadSerialPorts().then(ports => {
    configStore.set({ serialPorts: ports });
    if (ports.length === 0) {
      listEl.innerHTML = `<div class="settings-item-desc">No serial devices detected.</div>`;
      return;
    }
    const serialPortParams = configStore.get("serialPortParams");
    listEl.innerHTML = ports.map(p => {
      const ids = p.vid && p.pid ? `${p.vid}:${p.pid}` : "";
      const sub = [p.product || p.driver, p.manufacturer, ids].filter(Boolean).join(" \u00b7 ");
      const key = serialKeyFor(p);
      const mem = serialPortParams[key];
      const baud = mem?.baud ?? configStore.get("serialBaud");
      const mode = mem?.inputMode ?? configStore.get("serialInputMode");
      const nl = mem?.outputNewline ?? configStore.get("serialOutputNewline");
      const enter = mem?.enterNewline ?? configStore.get("serialEnterNewline");
      return `
        <div class="settings-item settings-item-row serial-port-row">
          <div class="settings-item-info">
            <div class="settings-item-title">${esc(p.name)}</div>
            <div class="settings-item-desc">${esc(sub)}</div>
          </div>
          <div class="settings-item-control" style="display:flex;gap:6px;">
            <select class="settings-select serial-port-baud" data-key="${esc(key)}">
              ${baudOptionsHtml(baud)}
            </select>
            <select class="settings-select serial-port-mode" data-key="${esc(key)}">
              ${inputModeOptionsHtml(mode)}
            </select>
            <select class="settings-select serial-port-nl" data-key="${esc(key)}">
              ${outputNewlineOptionsHtml(nl)}
            </select>
            <select class="settings-select serial-port-enter" data-key="${esc(key)}">
              ${enterNewlineOptionsHtml(enter)}
            </select>
          </div>
        </div>`;
    }).join("");

    listEl.querySelectorAll<HTMLSelectElement>(".serial-port-baud").forEach(sel => {
      sel.addEventListener("change", async () => {
        await rememberSerialParams(sel.dataset.key!, { baud: parseInt(sel.value, 10) });
        showToast(`Baud saved: ${sel.value}`, "info", 1500);
        renderHistory();
      });
    });
    listEl.querySelectorAll<HTMLSelectElement>(".serial-port-mode").forEach(sel => {
      sel.addEventListener("change", async () => {
        await rememberSerialParams(sel.dataset.key!, { inputMode: sel.value as SerialInputMode });
        showToast(`Input mode saved: ${sel.value}`, "info", 1500);
        renderHistory();
      });
    });
    listEl.querySelectorAll<HTMLSelectElement>(".serial-port-nl").forEach(sel => {
      sel.addEventListener("change", async () => {
        await rememberSerialParams(sel.dataset.key!, { outputNewline: sel.value as SerialOutputNewline });
        showToast(`Output newlines saved: ${sel.value}`, "info", 1500);
        renderHistory();
      });
    });
    listEl.querySelectorAll<HTMLSelectElement>(".serial-port-enter").forEach(sel => {
      sel.addEventListener("change", async () => {
        await rememberSerialParams(sel.dataset.key!, { enterNewline: sel.value as SerialEnterNewline });
        showToast(`Enter sends saved: ${sel.value}`, "info", 1500);
        renderHistory();
      });
    });
  });
}

export function collectSerialSettings(root: HTMLElement): Partial<ConfigState> {
  const partial: Partial<ConfigState> = {};
  const baudEl = root.querySelector("#set-serial-baud") as HTMLSelectElement;
  const modeEl = root.querySelector("#set-serial-input-mode") as HTMLSelectElement;
  const nlEl = root.querySelector("#set-serial-output-newline") as HTMLSelectElement;
  const enterEl = root.querySelector("#set-serial-enter-newline") as HTMLSelectElement;
  if (baudEl) partial.serialBaud = parseInt(baudEl.value, 10) || 115200;
  if (modeEl) partial.serialInputMode = modeEl.value as SerialInputMode;
  if (nlEl) partial.serialOutputNewline = nlEl.value as SerialOutputNewline;
  if (enterEl) partial.serialEnterNewline = enterEl.value as SerialEnterNewline;
  return partial;
}

export function refreshSerialPanelForm(root: HTMLElement): void {
  const baudEl = root.querySelector("#set-serial-baud") as HTMLSelectElement;
  const modeEl = root.querySelector("#set-serial-input-mode") as HTMLSelectElement;
  const nlEl = root.querySelector("#set-serial-output-newline") as HTMLSelectElement;
  const enterEl = root.querySelector("#set-serial-enter-newline") as HTMLSelectElement;
  if (baudEl) baudEl.value = String(configStore.get("serialBaud"));
  if (modeEl) modeEl.value = configStore.get("serialInputMode");
  if (nlEl) nlEl.value = configStore.get("serialOutputNewline");
  if (enterEl) enterEl.value = configStore.get("serialEnterNewline");
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
