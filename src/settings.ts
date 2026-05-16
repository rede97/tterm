import { localProfiles, configFontFamily, configFontSize, hiddenProfiles, saveConfig, loadConfig } from "./profiles";
import { invoke } from "@tauri-apps/api/core";

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
  navGeneral.textContent = "Appearance";
  navGeneral.dataset.panel = "general";

  const navWt = document.createElement("button");
  navWt.className = "settings-nav-item";
  navWt.textContent = "Profile";
  navWt.dataset.panel = "wt";

  sidebar.appendChild(navGeneral);
  sidebar.appendChild(navWt);
  root.appendChild(sidebar);

  // ── Body ──
  const body = document.createElement("div");
  body.className = "settings-body";

  const panelGeneral = document.createElement("div");
  panelGeneral.className = "settings-panel-content";
  panelGeneral.dataset.panel = "general";
  panelGeneral.innerHTML = `
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
  body.appendChild(panelGeneral);

  const panelWt = document.createElement("div");
  panelWt.className = "settings-panel-content";
  panelWt.dataset.panel = "wt";
  panelWt.style.display = "none";
  renderWtPanel(panelWt);
  body.appendChild(panelWt);

  // Footer
  const footer = document.createElement("div");
  footer.className = "settings-footer";

  const feedback = document.createElement("span");
  feedback.className = "settings-feedback";
  footer.appendChild(feedback);

  const spacer = document.createElement("div");
  spacer.style.flex = "1";
  footer.appendChild(spacer);

  // Reset button with dropdown
  const resetWrap = document.createElement("div");
  resetWrap.className = "settings-reset-wrap";

  const resetBtn = document.createElement("button");
  resetBtn.className = "settings-reset-btn";
  resetBtn.innerHTML = "&#9650;";
  resetBtn.title = "Reset";

  const resetMenu = document.createElement("div");
  resetMenu.className = "settings-reset-menu";

  const resetChanges = document.createElement("button");
  resetChanges.textContent = "Reset Changes";
  resetChanges.addEventListener("click", async () => {
    await loadConfig();
    refreshForm(root);
    (resetMenu as HTMLElement).style.display = "none";
    feedback.textContent = "Reverted to saved config";
    feedback.className = "settings-feedback settings-feedback-info";
    setTimeout(() => { feedback.textContent = ""; }, 2000);
  });
  resetMenu.appendChild(resetChanges);

  const resetAll = document.createElement("button");
  resetAll.textContent = "Reset All";
  resetAll.addEventListener("click", async () => {
    await invoke("write_config", { content: "{}" });
    await loadConfig();
    refreshForm(root);
    (resetMenu as HTMLElement).style.display = "none";
    feedback.textContent = "All settings cleared";
    feedback.className = "settings-feedback settings-feedback-info";
    setTimeout(() => { feedback.textContent = ""; }, 2000);
  });
  resetMenu.appendChild(resetAll);

  resetBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    resetMenu.style.display = resetMenu.style.display === "block" ? "none" : "block";
  });

  document.addEventListener("click", () => {
    resetMenu.style.display = "none";
  });

  resetWrap.appendChild(resetBtn);
  resetWrap.appendChild(resetMenu);
  footer.appendChild(resetWrap);

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
  const checks = root.querySelectorAll<HTMLInputElement>(".wt-profile-check");

  if (fontEl) fontEl.value = configFontFamily;
  if (sizeEl) sizeEl.value = String(configFontSize);
  if (profileEl && profileEl.options.length > 0) {
    profileEl.value = localProfiles[0]?.name ?? "";
  }
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
      <div class="settings-row settings-row-header">
        <span>Imported Profiles</span>
        <span class="settings-hint">Uncheck to hide</span>
      </div>
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
  const checks = root.querySelectorAll<HTMLInputElement>(".wt-profile-check");

  const partial: Record<string, unknown> = {};
  if (fontEl) partial.fontFamily = fontEl.value;
  if (sizeEl) partial.fontSize = Math.max(10, Math.min(32, parseInt(sizeEl.value, 10) || 14));
  if (profileEl) partial.defaultLocalProfile = profileEl.value;

  const hidden: string[] = [];
  checks.forEach(c => { if (!c.checked) hidden.push(c.value); });
  partial.hiddenProfiles = hidden;

  await saveConfig(partial);
  if (_onSettingsChanged) _onSettingsChanged();
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
