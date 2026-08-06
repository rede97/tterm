// Settings — General panel
// Renderer, scrollback, terminal bell, paste options, tab width, data management

import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { configStore, type ConfigState } from "../core/store";
import { logCatch, logError } from "../core/errorlog";
import { attachStepper } from "../ui/stepper";

export function createGeneralPanel(): HTMLElement {
  const panel = document.createElement("div");
  panel.className = "settings-panel-content";
  panel.dataset.panel = "general";
  panel.innerHTML = `
    <div class="settings-section">
      <div class="settings-section-title">About</div>
      <div class="settings-item">
        <div class="settings-about-row">
          <div>
            <div class="settings-item-title" id="set-version">TTerm</div>
            <div class="settings-item-desc" style="margin-bottom:20px">A fast, lightweight, efficient WebView Terminal.</div>
          </div>
          <button id="set-homepage" class="settings-link-btn" style="flex-shrink:0;background:#3a3a3a;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:6px;vertical-align:middle"><path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"/><path d="M9 18c-4.51 2-5-2-7-2"/></svg>
            Homepage
          </button>
        </div>
      </div>
    </div>
    <div class="settings-section">
      <div class="settings-section-title">Updates</div>
      <div class="settings-item settings-item-row">
        <div class="settings-item-info">
          <div class="settings-item-title">Check for updates automatically</div>
          <div class="settings-item-desc">Check GitHub Releases for a new version when the app starts.</div>
        </div>
        <div class="settings-item-control">
          <label class="settings-toggle-row" style="padding:0;gap:0;">
            <input type="checkbox" id="set-auto-update" ${configStore.get("autoCheckUpdates") ? "checked" : ""} />
          </label>
        </div>
      </div>
      <div class="settings-item settings-item-row">
        <div class="settings-item-info">
          <div class="settings-item-title">Manual check</div>
          <div class="settings-item-desc">Check for a new version right now.</div>
        </div>
        <div class="settings-item-control">
          <button id="set-check-update" class="settings-link-btn">Check for Updates</button>
        </div>
      </div>
    </div>
    <div class="settings-section">
      <div class="settings-section-title">Terminal</div>
      <div class="settings-item settings-item-row">
        <div class="settings-item-info">
          <div class="settings-item-title">Renderer</div>
          <div class="settings-item-desc">Rendering backend for terminal output. WebGL is faster, Canvas has broader compatibility.</div>
        </div>
        <div class="settings-item-control">
          <select id="set-renderer" class="settings-select">
            <option value="webgl" ${configStore.get("renderer") === "webgl" ? "selected" : ""}>WebGL</option>
            <option value="canvas" ${configStore.get("renderer") === "canvas" ? "selected" : ""}>Canvas</option>
          </select>
        </div>
      </div>
      <div class="settings-item settings-item-row">
        <div class="settings-item-info">
          <div class="settings-item-title">Scrollback</div>
          <div class="settings-item-desc">Maximum number of lines stored in the scrollback buffer.</div>
        </div>
        <div class="settings-item-control">
          <input type="number" id="set-scrollback" class="settings-input settings-input-narrow" value="${configStore.get("scrollback")}" min="100" max="100000" step="100" />
        </div>
      </div>
      <div class="settings-item settings-item-row">
        <div class="settings-item-info">
          <div class="settings-item-title">Terminal bell</div>
          <div class="settings-item-desc">Play a system sound when the terminal bell rings (BEL character).</div>
        </div>
        <div class="settings-item-control">
          <label class="settings-toggle-row" style="padding:0;gap:0;">
            <input type="checkbox" id="set-bell" ${configStore.get("terminalBell") ? "checked" : ""} />
          </label>
        </div>
      </div>
      <div class="settings-subsection">
        <div class="settings-subsection-title">Paste</div>
        <div class="settings-item settings-item-row">
          <div class="settings-item-info">
            <div class="settings-item-title">Multi-line paste warning</div>
            <div class="settings-item-desc">Show a confirmation dialog when pasting text that spans multiple lines.</div>
          </div>
          <div class="settings-item-control">
            <label class="settings-toggle-row" style="padding:0;gap:0;">
              <input type="checkbox" id="set-paste-warning" ${configStore.get("pasteWarning") ? "checked" : ""} />
            </label>
          </div>
        </div>
        <div class="settings-item settings-item-row">
          <div class="settings-item-info">
            <div class="settings-item-title">Trim whitespace</div>
            <div class="settings-item-desc">Strip leading, trailing, and blank lines from pasted content.</div>
          </div>
          <div class="settings-item-control">
            <label class="settings-toggle-row" style="padding:0;gap:0;">
              <input type="checkbox" id="set-paste-trim" ${configStore.get("pasteTrim") ? "checked" : ""} />
            </label>
          </div>
        </div>
      </div>
      
    </div>
    <div class="settings-section">
      <div class="settings-section-title">Data</div>
      <div class="settings-item settings-item-row">
        <div class="settings-item-info">
          <div class="settings-item-title">Configuration</div>
        </div>
        <div class="settings-item-control" style="display:flex;gap:8px;">
          <button id="set-open-config-dir" class="settings-link-btn">Open Directory</button>
          <button id="set-reset-all" class="settings-link-btn settings-link-btn-danger">Reset All</button>
        </div>
      </div>
    </div>
  `;

  // populate version async
  getVersion().then(v => {
    const el = panel.querySelector("#set-version");
    if (el) el.textContent = "TTerm " + v;
  }).catch(() => {});

  // Scrollback gets the shared stepper (native spinners are hidden globally).
  attachStepper(panel.querySelector<HTMLInputElement>("#set-scrollback")!);

  // homepage link
  panel.querySelector("#set-homepage")!.addEventListener("click", (e) => {
    e.preventDefault();
    openUrl("https://github.com/rede97/tterm");
  });

  // manual update check
  panel.querySelector("#set-check-update")!.addEventListener("click", () => {
    import("../core/updater").then(m => m.checkForUpdates(true)).catch(logCatch("updater.manual"));
  });

  // open config directory
  panel.querySelector("#set-open-config-dir")!.addEventListener("click", () => {
    invoke("open_config_dir").catch(logError.bind(null, "config.openDir"));
  });

  // reset all settings
  panel.querySelector("#set-reset-all")!.addEventListener("click", async () => {
    await invoke("delete_config");
    await configStore.load();
    // Notify parent to refresh
    const evt = new CustomEvent("tterm-settings-reset");
    panel.dispatchEvent(evt);
  });

  return panel;
}

export function refreshGeneralPanel(root: HTMLElement): void {
  const pasteWarnEl = root.querySelector("#set-paste-warning") as HTMLInputElement;
  const pasteTrimEl = root.querySelector("#set-paste-trim") as HTMLInputElement;
  const bellEl = root.querySelector("#set-bell") as HTMLInputElement;
  const rendererEl = root.querySelector("#set-renderer") as HTMLSelectElement;
  const scrollbackEl = root.querySelector("#set-scrollback") as HTMLInputElement;

  if (pasteWarnEl) pasteWarnEl.checked = configStore.get("pasteWarning");
  if (pasteTrimEl) pasteTrimEl.checked = configStore.get("pasteTrim");
  if (bellEl) bellEl.checked = configStore.get("terminalBell");
  if (rendererEl) rendererEl.value = configStore.get("renderer");
  if (scrollbackEl) scrollbackEl.value = String(configStore.get("scrollback"));

  const autoUpdateEl = root.querySelector("#set-auto-update") as HTMLInputElement;
  if (autoUpdateEl) autoUpdateEl.checked = configStore.get("autoCheckUpdates");
}

export function collectGeneralSettings(root: HTMLElement): Partial<ConfigState> {
  const partial: Partial<ConfigState> = {};
  const pasteWarnEl = root.querySelector("#set-paste-warning") as HTMLInputElement;
  const bellEl = root.querySelector("#set-bell") as HTMLInputElement;
  const pasteTrimEl = root.querySelector("#set-paste-trim") as HTMLInputElement;
  const rendererEl = root.querySelector("#set-renderer") as HTMLSelectElement;
  const scrollbackEl = root.querySelector("#set-scrollback") as HTMLInputElement;

  if (pasteWarnEl) partial.pasteWarning = pasteWarnEl.checked;
  if (pasteTrimEl) partial.pasteTrim = pasteTrimEl.checked;
  if (bellEl) partial.terminalBell = bellEl.checked;
  if (rendererEl) partial.renderer = rendererEl.value;
  if (scrollbackEl) partial.scrollback = Math.max(100, Math.min(100000, parseInt(scrollbackEl.value, 10) || 1000));
  const autoUpdateEl = root.querySelector("#set-auto-update") as HTMLInputElement;
  if (autoUpdateEl) partial.autoCheckUpdates = autoUpdateEl.checked;
  return partial;
}
