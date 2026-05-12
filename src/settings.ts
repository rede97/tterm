import { localProfiles, configFontFamily, configFontSize, hiddenProfiles, saveConfig } from "./profiles";

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

  // ── Tabs ──
  const tabBar = document.createElement("div");
  tabBar.className = "settings-tabs";

  const tabGeneral = document.createElement("button");
  tabGeneral.className = "settings-tab active";
  tabGeneral.textContent = "General";
  tabGeneral.dataset.panel = "general";

  const tabWt = document.createElement("button");
  tabWt.className = "settings-tab";
  tabWt.textContent = "Windows Terminal";
  tabWt.dataset.panel = "wt";

  tabBar.appendChild(tabGeneral);
  tabBar.appendChild(tabWt);
  root.appendChild(tabBar);

  // ── General panel ──
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
    <div class="settings-section">
      <div class="settings-section-title">Default Profile</div>
      <div class="settings-row">
        <select id="set-default-profile" class="settings-select">
          ${localProfiles.map(p => `<option value="${esc(p.name)}">${esc(p.name)}</option>`).join("")}
        </select>
      </div>
    </div>
  `;
  root.appendChild(panelGeneral);

  // ── WT panel ──
  const panelWt = document.createElement("div");
  panelWt.className = "settings-panel-content";
  panelWt.dataset.panel = "wt";
  panelWt.style.display = "none";
  renderWtPanel(panelWt);
  root.appendChild(panelWt);

  // tab switching
  const tabs = root.querySelectorAll(".settings-tab");
  tabs.forEach(t => {
    t.addEventListener("click", () => {
      tabs.forEach(x => x.classList.remove("active"));
      t.classList.add("active");
      const name = (t as HTMLElement).dataset.panel!;
      root.querySelectorAll(".settings-panel-content").forEach(p => {
        (p as HTMLElement).style.display = p.getAttribute("data-panel") === name ? "" : "none";
      });
    });
  });

  // apply button
  const footer = document.createElement("div");
  footer.className = "settings-footer";
  const btn = document.createElement("button");
  btn.className = "settings-btn";
  btn.textContent = "Apply";
  btn.addEventListener("click", () => applySettings(root));
  footer.appendChild(btn);
  root.appendChild(footer);

  return root;
}

function renderWtPanel(container: HTMLElement) {
  container.innerHTML = `
    <div class="settings-section">
      <div class="settings-row settings-row-header">
        <span>Profiles loaded from Windows Terminal</span>
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
