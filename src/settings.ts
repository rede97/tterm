import { localProfiles, configFontFamily, configFontSize, hiddenProfiles, configPasteWarning, configPasteTrim, configTerminalBell, configRenderer, configScrollback, configTabWidthMode, saveConfig, loadConfig } from "./profiles";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";

let _onSettingsChanged: (() => void) | null = null;
export function onSettingsChangedFn(): (() => void) | null { return _onSettingsChanged; }
export function setOnSettingsChanged(fn: (() => void) | null) { _onSettingsChanged = fn; }

const FONT_SUGGESTIONS = [
  "JetBrains Mono",
  "Cascadia Code",
  "Cascadia Mono",
  "Consolas",
  "Fira Code",
  "Source Code Pro",
  "Hack",
  "MesloLGS NF",
  "Ubuntu Mono",
  "DejaVu Sans Mono",
  "monospace",
];

export function createSettingsContent(): HTMLElement {
  const root = document.createElement("div");
  root.className = "settings-page";

  // -- Sidebar --
  const sidebar = document.createElement("div");
  sidebar.className = "settings-sidebar";

  const navGeneral = document.createElement("button");
  navGeneral.className = "settings-nav-item active";
  navGeneral.textContent = "General";
  navGeneral.dataset.panel = "general";

  const navAppearance = document.createElement("button");
  navAppearance.className = "settings-nav-item";
  navAppearance.textContent = "Appearance";
  navAppearance.dataset.panel = "appearance";

  const navProfile = document.createElement("button");
  navProfile.className = "settings-nav-item";
  navProfile.textContent = "Profile";
  navProfile.dataset.panel = "profile";

  sidebar.appendChild(navGeneral);
  sidebar.appendChild(navAppearance);
  sidebar.appendChild(navProfile);
  root.appendChild(sidebar);

  // -- Body --
  const body = document.createElement("div");
  body.className = "settings-body";

  // General panel
  const panelGeneral = document.createElement("div");
  panelGeneral.className = "settings-panel-content";
  panelGeneral.dataset.panel = "general";
  panelGeneral.innerHTML = `
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
      <div class="settings-section-title">Terminal</div>
      <div class="settings-item settings-item-row">
        <div class="settings-item-info">
          <div class="settings-item-title">Renderer</div>
          <div class="settings-item-desc">Rendering backend for terminal output. WebGL is faster, Canvas has broader compatibility.</div>
        </div>
        <div class="settings-item-control">
          <select id="set-renderer" class="settings-select">
            <option value="webgl" ${configRenderer === "webgl" ? "selected" : ""}>WebGL</option>
            <option value="canvas" ${configRenderer === "canvas" ? "selected" : ""}>Canvas</option>
          </select>
        </div>
      </div>
      <div class="settings-item settings-item-row">
        <div class="settings-item-info">
          <div class="settings-item-title">Scrollback</div>
          <div class="settings-item-desc">Maximum number of lines stored in the scrollback buffer.</div>
        </div>
        <div class="settings-item-control">
          <input type="number" id="set-scrollback" class="settings-input settings-input-narrow" value="${configScrollback}" min="100" max="100000" step="100" />
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
              <input type="checkbox" id="set-paste-warning" ${configPasteWarning ? "checked" : ""} />
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
              <input type="checkbox" id="set-paste-trim" ${configPasteTrim ? "checked" : ""} />
            </label>
          </div>
        </div>
      </div>
      <div class="settings-item settings-item-row">
        <div class="settings-item-info">
          <div class="settings-item-title">Terminal bell</div>
          <div class="settings-item-desc">Play a system sound when the terminal bell rings (BEL character).</div>
        </div>
        <div class="settings-item-control">
          <label class="settings-toggle-row" style="padding:0;gap:0;">
            <input type="checkbox" id="set-bell" ${configTerminalBell ? "checked" : ""} />
          </label>
        </div>
      </div>
    </div>
    <div class="settings-section">
      <div class="settings-section-title">Tabs</div>
      <div class="settings-item settings-item-row">
        <div class="settings-item-info">
          <div class="settings-item-title">Tab width</div>
          <div class="settings-item-desc">Equal makes all tabs the same width. Adaptive sizes each tab to fit its title.</div>
        </div>
        <div class="settings-item-control">
          <select id="set-tab-width" class="settings-select">
            <option value="equal" ${configTabWidthMode === "equal" ? "selected" : ""}>Equal</option>
            <option value="adaptive" ${configTabWidthMode === "adaptive" ? "selected" : ""}>Adaptive</option>
          </select>
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
  body.appendChild(panelGeneral);

  // populate version async
  getVersion().then(v => {
    const el = document.getElementById("set-version");
    if (el) el.textContent = "TTerm " + v;
  }).catch(() => {});

  // homepage link
  panelGeneral.querySelector("#set-homepage")!.addEventListener("click", (e) => {
    e.preventDefault();
    openUrl("https://github.com/rede97/tterm");
  });

  // open config directory
  panelGeneral.querySelector("#set-open-config-dir")!.addEventListener("click", () => {
    invoke("open_config_dir").catch(console.error);
  });

  // reset all settings
  panelGeneral.querySelector("#set-reset-all")!.addEventListener("click", async () => {
    await invoke("delete_config");
    await loadConfig();
    refreshForm(root);
    feedback.textContent = "All settings cleared";
    feedback.className = "settings-feedback settings-feedback-info";
    setTimeout(() => { feedback.textContent = ""; }, 2000);
  });

  // Appearance panel
  const panelAppearance = document.createElement("div");
  panelAppearance.className = "settings-panel-content";
  panelAppearance.dataset.panel = "appearance";
  panelAppearance.style.display = "none";
  panelAppearance.innerHTML = `
    <div class="settings-section">
      <div class="settings-section-title">Font</div>
      <div class="settings-item settings-item-row">
        <div class="settings-item-info">
          <div class="settings-item-title">Font Family</div>
          <div class="settings-item-desc">Font used for terminal text. Choose a monospace font for best results.</div>
        </div>
        <div class="settings-item-control">
          <input type="text" id="set-font-family" class="settings-input" value="${esc(configFontFamily)}" list="font-family-list" />
          <datalist id="font-family-list">${FONT_SUGGESTIONS.map(f => `<option value="${esc(f)}">`).join("")}</datalist>
        </div>
      </div>
      <div class="settings-item settings-item-row">
        <div class="settings-item-info">
          <div class="settings-item-title">Font Size</div>
          <div class="settings-item-desc">Size of the terminal font in pixels.</div>
        </div>
        <div class="settings-item-control">
          <input type="number" id="set-font-size" class="settings-input settings-input-narrow" value="${configFontSize}" min="10" max="32" step="1" />
        </div>
      </div>
    </div>
  `;
  body.appendChild(panelAppearance);

  // Profile panel
  const panelProfile = document.createElement("div");
  panelProfile.className = "settings-panel-content";
  panelProfile.dataset.panel = "profile";
  panelProfile.style.display = "none";
  renderWtPanel(panelProfile);
  body.appendChild(panelProfile);

  // Footer
  const footer = document.createElement("div");
  footer.className = "settings-footer";

  const feedback = document.createElement("span");
  feedback.className = "settings-feedback";
  footer.appendChild(feedback);

  const spacer = document.createElement("div");
  spacer.style.flex = "1";
  footer.appendChild(spacer);

  // Revert button
  const revertBtn = document.createElement("button");
  revertBtn.className = "settings-btn settings-btn-revert";
  revertBtn.textContent = "Revert";
  revertBtn.addEventListener("click", async () => {
    await loadConfig();
    refreshForm(root);
    feedback.textContent = "Reverted to saved config";
    feedback.className = "settings-feedback settings-feedback-info";
    setTimeout(() => { feedback.textContent = ""; }, 2000);
  });
  footer.appendChild(revertBtn);

  // Apply button
  const applyBtn = document.createElement("button");
  applyBtn.className = "settings-btn";
  applyBtn.textContent = "Apply";
  applyBtn.addEventListener("click", async () => {
    await applySettings(root);
    applyBtn.classList.add("applied");
    feedback.textContent = "Config saved";
    feedback.className = "settings-feedback settings-feedback-ok";
    setTimeout(() => { feedback.textContent = ""; }, 2500);
  });
  footer.appendChild(applyBtn);

  body.appendChild(footer);
  root.appendChild(body);

  // Enable Apply on any input change
  root.querySelectorAll("input, select").forEach(el => {
    el.addEventListener("input", () => applyBtn.classList.remove("applied"));
    el.addEventListener("change", () => applyBtn.classList.remove("applied"));
  });

  // sidebar navigation
  const navItems = root.querySelectorAll(".settings-nav-item");
  navItems.forEach(t => {
    t.addEventListener("click", () => {
      navItems.forEach(x => x.classList.remove("active"));
      t.classList.add("active");
      const name = (t as HTMLElement).dataset.panel!;
      root.querySelectorAll(".settings-panel-content").forEach(p => {
        (p as HTMLElement).style.display = p.getAttribute("data-panel") === name ? "" : "none";
      });
    });
  });

  return root;
}

function refreshForm(root: HTMLElement) {
  const fontEl = root.querySelector("#set-font-family") as HTMLInputElement;
  const sizeEl = root.querySelector("#set-font-size") as HTMLInputElement;
  const profileEl = root.querySelector("#set-default-profile") as HTMLSelectElement;
  const pasteWarnEl = root.querySelector("#set-paste-warning") as HTMLInputElement;
  const bellEl = root.querySelector("#set-bell") as HTMLInputElement;
  const checks = root.querySelectorAll<HTMLInputElement>(".wt-profile-check");

  if (fontEl) fontEl.value = configFontFamily;
  if (sizeEl) sizeEl.value = String(configFontSize);
  if (profileEl && profileEl.options.length > 0) {
    profileEl.value = localProfiles[0]?.name ?? "";
  }
  if (pasteWarnEl) pasteWarnEl.checked = configPasteWarning;
  const pasteTrimEl = root.querySelector("#set-paste-trim") as HTMLInputElement;
  if (pasteTrimEl) pasteTrimEl.checked = configPasteTrim;
  if (bellEl) bellEl.checked = configTerminalBell;
  const rendererEl = root.querySelector("#set-renderer") as HTMLSelectElement;
  if (rendererEl) rendererEl.value = configRenderer;
  const scrollbackEl = root.querySelector("#set-scrollback") as HTMLInputElement;
  if (scrollbackEl) scrollbackEl.value = String(configScrollback);
  const tabWidthEl = root.querySelector("#set-tab-width") as HTMLSelectElement;
  if (tabWidthEl) tabWidthEl.value = configTabWidthMode;
  checks.forEach(c => {
    c.checked = !hiddenProfiles.includes(c.value);
  });
}

function renderWtPanel(container: HTMLElement) {
  container.innerHTML = `
    <div class="settings-section">
      <div class="settings-section-title">Default Profile</div>
      <div class="settings-item settings-item-row">
        <div class="settings-item-info">
          <div class="settings-item-title">Default Profile</div>
        </div>
        <div class="settings-item-control">
          <select id="set-default-profile" class="settings-select">
            ${localProfiles.map(p => `<option value="${esc(p.name)}">${esc(p.name)}</option>`).join("")}
          </select>
        </div>
      </div>
    </div>
    <div class="settings-section">
      <div class="settings-section-title">Imported from Windows Terminal</div>
      <div class="settings-item-desc" style="margin-bottom:10px">Toggle visibility of profiles imported from Windows Terminal. Uncheck to hide.</div>
      ${localProfiles.map(p => {
        const checked = !hiddenProfiles.includes(p.name);
        return `<label class="settings-item settings-item-row" style="cursor:pointer;margin-bottom:4px;background:#2a2a2a;border-radius:4px;padding:6px 10px;">
          <div class="settings-item-info">
            <div class="settings-item-title" style="margin-bottom:0;">${esc(p.name)}</div>
            <div class="settings-item-desc" style="margin-bottom:0;">${esc(p.command)}</div>
          </div>
          <div class="settings-item-control">
            <label class="settings-toggle-row" style="padding:0;gap:0;">
              <input type="checkbox" class="wt-profile-check" value="${esc(p.name)}" ${checked ? "checked" : ""} />
            </label>
          </div>
        </label>`;
      }).join("")}
    </div>
  `;
}

async function applySettings(root: HTMLElement) {
  const fontEl = root.querySelector("#set-font-family") as HTMLInputElement;
  const sizeEl = root.querySelector("#set-font-size") as HTMLInputElement;
  const profileEl = root.querySelector("#set-default-profile") as HTMLSelectElement;
  const pasteWarnEl = root.querySelector("#set-paste-warning") as HTMLInputElement;
  const bellEl = root.querySelector("#set-bell") as HTMLInputElement;
  const checks = root.querySelectorAll<HTMLInputElement>(".wt-profile-check");

  const partial: Record<string, unknown> = {};
  if (fontEl) partial.fontFamily = fontEl.value;
  if (sizeEl) partial.fontSize = Math.max(10, Math.min(32, parseInt(sizeEl.value, 10) || 14));
  if (profileEl) partial.defaultLocalProfile = profileEl.value;
  if (pasteWarnEl) partial.pasteWarning = pasteWarnEl.checked;
  const pasteTrimEl = root.querySelector("#set-paste-trim") as HTMLInputElement;
  if (pasteTrimEl) partial.pasteTrim = pasteTrimEl.checked;
  if (bellEl) partial.terminalBell = bellEl.checked;
  const rendererEl = root.querySelector("#set-renderer") as HTMLSelectElement;
  if (rendererEl) partial.renderer = rendererEl.value;
  const scrollbackEl = root.querySelector("#set-scrollback") as HTMLInputElement;
  if (scrollbackEl) partial.scrollback = Math.max(100, Math.min(100000, parseInt(scrollbackEl.value, 10) || 1000));
  const tabWidthEl = root.querySelector("#set-tab-width") as HTMLSelectElement;
  if (tabWidthEl) partial.tabWidthMode = tabWidthEl.value;

  const hidden: string[] = [];
  checks.forEach(c => { if (!c.checked) hidden.push(c.value); });
  partial.hiddenProfiles = hidden;

  await saveConfig(partial);
  if (_onSettingsChanged) _onSettingsChanged();
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}





// 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, Courier, monospace





