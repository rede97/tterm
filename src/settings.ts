import { localProfiles, configFontFamily, configFontSize, hiddenProfiles, configPasteWarning, configTerminalBell, saveConfig, loadConfig } from "./profiles";
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

  // ── Sidebar ──
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

  // ── Body ──
  const body = document.createElement("div");
  body.className = "settings-body";

  // General panel
  const panelGeneral = document.createElement("div");
  panelGeneral.className = "settings-panel-content";
  panelGeneral.dataset.panel = "general";
  panelGeneral.innerHTML = `
    <div class="settings-section">
      <div class="settings-section-title">About</div>
      <div class="settings-row">
        <span class="settings-label">Version</span>
        <span id="set-version" class="settings-value"></span>
      </div>
      <div class="settings-row">
        <a id="set-homepage" class="settings-link" href="#">Project Homepage</a>
      </div>
    </div>
    <div class="settings-section">
      <div class="settings-section-title">Terminal</div>
      <label class="settings-toggle-row">
        <input type="checkbox" id="set-paste-warning" ${configPasteWarning ? "checked" : ""} />
        <span>Multi-line paste warning</span>
      </label>
      <label class="settings-toggle-row">
        <input type="checkbox" id="set-bell" ${configTerminalBell ? "checked" : ""} />
        <span>Terminal bell</span>
      </label>
    </div>
    <div class="settings-section">
      <div class="settings-section-title">Data</div>
      <div class="settings-row">
        <button id="set-open-config-dir" class="settings-link-btn">Open Config Directory</button>
      </div>
      <div class="settings-row">
        <button id="set-reset-all" class="settings-link-btn settings-link-btn-danger">Reset All Settings</button>
      </div>
    </div>
  `;
  body.appendChild(panelGeneral);

  // populate version async
  getVersion().then(v => {
    const el = document.getElementById("set-version");
    if (el) el.textContent = v;
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
    await invoke("write_config", { content: "{}" });
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
      <div class="settings-row">
        <label class="settings-label">Family</label>
        <input type="text" id="set-font-family" class="settings-input" value="${esc(configFontFamily)}" list="font-family-list" />
        <datalist id="font-family-list">${FONT_SUGGESTIONS.map(f => `<option value="${esc(f)}">`).join("")}</datalist>
      </div>
      <div class="settings-row">
        <label class="settings-label">Size</label>
        <input type="number" id="set-font-size" class="settings-input settings-input-narrow" value="${configFontSize}" min="10" max="32" step="1" />
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
  if (bellEl) bellEl.checked = configTerminalBell;
  checks.forEach(c => {
    c.checked = !hiddenProfiles.includes(c.value);
  });
}

function renderWtPanel(container: HTMLElement) {
  container.innerHTML = `
    <div class="settings-section">
      <div class="settings-section-title">Default Profile</div>
      <div class="settings-row">
        <select id="set-default-profile" class="settings-select">
          ${localProfiles.map(p => `<option value="${esc(p.name)}">${esc(p.name)}</option>`).join("")}
        </select>
      </div>
    </div>
    <div class="settings-section">
      <div class="settings-section-title">Imported Profiles</div>
      <div class="settings-hint">Uncheck to hide</div>
      ${localProfiles.map(p => {
        const checked = !hiddenProfiles.includes(p.name);
        return `<label class="settings-toggle-row">
          <input type="checkbox" class="wt-profile-check" value="${esc(p.name)}" ${checked ? "checked" : ""} />
          <span>${esc(p.name)}</span>
          <span class="settings-detail">${esc(p.command)}</span>
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
  if (bellEl) partial.terminalBell = bellEl.checked;

  const hidden: string[] = [];
  checks.forEach(c => { if (!c.checked) hidden.push(c.value); });
  partial.hiddenProfiles = hidden;

  await saveConfig(partial);
  if (_onSettingsChanged) _onSettingsChanged();
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
