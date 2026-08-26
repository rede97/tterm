// Settings — General panel (lit-html)
// Renderer, scrollback, terminal bell, paste options, data management.
//
// lit-html panel: renders through lit-html's diffing render() from store
// + per-panel state.
// Pending control edits live in panel state (not rescued DOM), so a Revert
// re-render resets them from the store and a mid-edit re-render (the async
// version label landing) never clobbers them.

import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { logCatch, logError, swallow } from "../core/errorlog";
import { type ConfigState, configStore } from "../core/store";
import { html, itemRow, linkBtn, nothing, render, section, toggle } from "../ui/lit";
import { syncSelectTexts, ttSelect } from "../ui/select";
import { attachStepper } from "../ui/stepper";

// ---- Per-panel state -------------------------------------------------
// Pending control values + the async version label. The store stays the
// source of truth: state initializes from it and refreshGeneralPanel
// resets to it (Revert). Per panel element so a second Settings page
// never inherits another's pending edits.

interface GeneralPanelState {
  // Version label, pushed in async by getVersion(); null = not resolved yet.
  version: string | null;
  autoUpdate: boolean;
  renderer: string;
  scrollback: string;
  bell: boolean;
  pasteWarning: boolean;
  pasteTrim: boolean;
  confirmCloseWindow: boolean;
}

const panelStates = new WeakMap<HTMLElement, GeneralPanelState>();

// Everything except the async version label comes straight from the store.
function readStore() {
  return {
    autoUpdate: configStore.get("autoCheckUpdates"),
    renderer: configStore.get("renderer"),
    scrollback: String(configStore.get("scrollback")),
    bell: configStore.get("terminalBell"),
    pasteWarning: configStore.get("pasteWarning"),
    pasteTrim: configStore.get("pasteTrim"),
    confirmCloseWindow: configStore.get("confirmCloseWindow"),
  };
}

function stateOf(panel: HTMLElement): GeneralPanelState {
  let st = panelStates.get(panel);
  if (!st) {
    st = { version: null, ...readStore() };
    panelStates.set(panel, st);
  }
  return st;
}

export function createGeneralPanel(): HTMLElement {
  const panel = document.createElement("div");
  panel.className = "settings-panel-content";
  panel.dataset.panel = "general";
  rebuildGeneralPanel(panel);

  // Populate the version label async. Kept in panel state (not a
  // post-render DOM write) so later re-renders don't clobber it.
  const st = stateOf(panel);
  getVersion()
    .then((v) => {
      st.version = v;
      if (panel.isConnected) renderGeneralPanel(panel);
    })
    .catch(swallow); // version label is cosmetic — stay on the bare "TTerm"

  return panel;
}

export function refreshGeneralPanel(root: HTMLElement): void {
  // Re-render ONLY the General panel inside the settings page, with pending
  // edits dropped back to the store (Revert semantics).
  const panel = root.querySelector<HTMLElement>('.settings-panel-content[data-panel="general"]');
  if (!panel) return;
  // Revert drops pending edits back to the store (version label kept).
  Object.assign(stateOf(panel), readStore());
  rebuildGeneralPanel(panel);
}

// ---- Rendering ---------------------------------------------------------

function renderGeneralPanel(panel: HTMLElement): void {
  render(generalTemplate(panel, stateOf(panel)), panel);
  syncSelectTexts(panel);
}

// Full clear + rebuild. A plain diffing re-render can't reset pending DOM
// edits: lit skips a property binding whose new value equals the last
// committed one, even when the live DOM diverged (user edited without
// Apply). Revert must always land the store values, so it rebuilds —
// which also means re-attaching the stepper.
function rebuildGeneralPanel(panel: HTMLElement): void {
  render(nothing, panel);
  renderGeneralPanel(panel);
  const scrollbackInput = panel.querySelector<HTMLInputElement>("#set-scrollback");
  if (scrollbackInput) attachStepper(scrollbackInput);
}

function generalTemplate(panel: HTMLElement, st: GeneralPanelState) {
  return html`
    ${section(
      "About",
      html`<div class="settings-item">
        <div class="settings-about-row">
          <div>
            <div class="settings-item-title" id="set-version">TTerm${st.version ? ` ${st.version}` : ""}</div>
            <div class="settings-item-desc" style="margin-bottom:20px">A fast, lightweight, efficient WebView Terminal.</div>
          </div>
          <button
            id="set-homepage"
            class="settings-link-btn solid"
            style="flex-shrink:0;"
            @click=${(e: Event) => {
              e.preventDefault();
              openUrl("https://github.com/rede97/tterm");
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:6px;vertical-align:middle"><path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85-1.65-.17.6-.22 1.23-.15 1.85v4"/><path d="M9 18c-4.51 2-5-2-7-2"/></svg>
            Homepage
          </button>
        </div>
      </div>`,
    )}
    ${section(
      "Updates",
      html`
        ${itemRow(
          "Check for updates automatically",
          "Check GitHub Releases for a new version when the app starts.",
          toggle(st.autoUpdate, (v) => (st.autoUpdate = v), { id: "set-auto-update" }),
        )}
        ${itemRow(
          "Manual check",
          "Check for a new version right now.",
          linkBtn(
            "Check for Updates",
            () => {
              import("../core/updater")
                .then((m) => m.checkForUpdates(true))
                .catch(logCatch("updater.manual"));
            },
            { id: "set-check-update", cls: "solid" },
          ),
        )}
      `,
    )}
    ${section(
      "Terminal",
      html`
        ${itemRow(
          "Renderer",
          "Rendering backend for terminal output. WebGL is faster, Canvas has broader compatibility.",
          ttSelect(
            "Renderer",
            [
              ["webgl", "WebGL"],
              ["canvas", "Canvas"],
            ],
            st.renderer,
            (v) => {
              st.renderer = v;
            },
            { id: "set-renderer" },
          ),
        )}
        ${itemRow(
          "Scrollback",
          "Maximum number of lines stored in the scrollback buffer.",
          html`<input
            type="number"
            id="set-scrollback"
            class="settings-input settings-input-narrow"
            .value=${st.scrollback}
            min="100"
            max="100000"
            step="100"
            @change=${(e: Event) => (st.scrollback = (e.target as HTMLInputElement).value)}
          />`,
        )}
        ${itemRow(
          "Terminal bell",
          "Play a system sound when the terminal bell rings (BEL character).",
          toggle(st.bell, (v) => (st.bell = v), { id: "set-bell" }),
        )}
        <div class="settings-subsection">
          <div class="settings-subsection-title">Paste</div>
          ${itemRow(
            "Multi-line paste warning",
            "Show a confirmation dialog when pasting text that spans multiple lines.",
            toggle(st.pasteWarning, (v) => (st.pasteWarning = v), { id: "set-paste-warning" }),
          )}
          ${itemRow(
            "Trim whitespace",
            "Strip leading, trailing, and blank lines from pasted content.",
            toggle(st.pasteTrim, (v) => (st.pasteTrim = v), { id: "set-paste-trim" }),
          )}
          ${itemRow(
            "Confirm before closing window",
            "When any tab is open, ask before closing the window. Off = quit immediately.",
            toggle(st.confirmCloseWindow, (v) => (st.confirmCloseWindow = v), {
              id: "set-confirm-close-window",
            }),
          )}
        </div>
      `,
    )}
    ${section(
      "Data",
      html`<div class="settings-item settings-item-row">
        <div class="settings-item-info">
          <div class="settings-item-title">Configuration</div>
        </div>
        <div class="settings-item-control" style="gap:8px;">
          ${linkBtn(
            "Open Directory",
            () => {
              invoke("open_config_dir").catch(logError.bind(null, "config.openDir"));
            },
            { id: "set-open-config-dir", cls: "solid" },
          )}
          ${linkBtn(
            "Reset All",
            async () => {
              await invoke("delete_config_file", { name: "config" });
              await invoke("delete_config_file", { name: "keybindings" });
              await configStore.load();
              // Notify parent to refresh
              panel.dispatchEvent(new CustomEvent("tterm-settings-reset"));
            },
            { danger: true, id: "set-reset-all", cls: "solid" },
          )}
        </div>
      </div>`,
    )}
  `;
}

export function collectGeneralSettings(root: HTMLElement): Partial<ConfigState> {
  const partial: Partial<ConfigState> = {};
  const pasteWarnEl = root.querySelector("#set-paste-warning") as HTMLInputElement;
  const bellEl = root.querySelector("#set-bell") as HTMLInputElement;
  const pasteTrimEl = root.querySelector("#set-paste-trim") as HTMLInputElement;
  const confirmCloseEl = root.querySelector("#set-confirm-close-window") as HTMLInputElement;
  const rendererEl = root.querySelector<HTMLElement>("#set-renderer");
  const scrollbackEl = root.querySelector("#set-scrollback") as HTMLInputElement;

  if (pasteWarnEl) partial.pasteWarning = pasteWarnEl.getAttribute("aria-checked") === "true";
  if (pasteTrimEl) partial.pasteTrim = pasteTrimEl.getAttribute("aria-checked") === "true";
  if (confirmCloseEl)
    partial.confirmCloseWindow = confirmCloseEl.getAttribute("aria-checked") === "true";
  if (bellEl) partial.terminalBell = bellEl.getAttribute("aria-checked") === "true";
  if (rendererEl) partial.renderer = rendererEl.dataset.current ?? "webgl";
  if (scrollbackEl)
    partial.scrollback = Math.max(100, Math.min(100000, parseInt(scrollbackEl.value, 10) || 1000));
  const autoUpdateEl = root.querySelector("#set-auto-update") as HTMLInputElement;
  if (autoUpdateEl) partial.autoCheckUpdates = autoUpdateEl.getAttribute("aria-checked") === "true";
  return partial;
}
