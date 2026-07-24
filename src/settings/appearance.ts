// Settings — Appearance panel
// Font family, font size, color scheme gallery

import { configStore, type ConfigState } from "../core/store";
import { buildFontFamily, updateFontStack } from "../util/fontconfig";
import { allThemes } from "../util/themes";

export function createAppearancePanel(): HTMLElement {
  const panel = document.createElement("div");
  panel.className = "settings-panel-content";
  panel.dataset.panel = "appearance";
  panel.style.display = "none";
  panel.innerHTML = `
    <div class="settings-section">
      <div class="settings-section-title">Font</div>
      <div class="settings-item settings-item-row">
        <div class="settings-item-info">
          <div class="settings-item-title">Font Family</div>
          <div class="settings-item-desc" id="set-font-family-desc">${esc(configStore.get("fontFamily"))}</div>
        </div>
        <div class="settings-item-control">
          <button id="set-font-config" class="settings-link-btn">Configure</button>
        </div>
      </div>
      <div class="settings-item settings-item-row">
        <div class="settings-item-info">
          <div class="settings-item-title">Font Size</div>
          <div class="settings-item-desc">Size of the terminal font in pixels.</div>
        </div>
        <div class="settings-item-control">
          <input type="number" id="set-font-size" class="settings-input settings-input-narrow" value="${configStore.get("fontSize")}" min="10" max="32" step="1" />
        </div>
      </div>
    </div>
    <div class="settings-section">
      <div class="settings-section-title">Color Scheme</div>
      <div class="settings-item-desc" style="margin-bottom:6px">Click a card to choose. Windows Terminal schemes are imported automatically.</div>
      <div id="set-theme-gallery" class="theme-gallery"></div>
    </div>
  `;

  // Font config button — opens font picker
  panel.querySelector("#set-font-config")!.addEventListener("click", () => {
    import("../terminal/fontpicker").then(m => {
      m.showFontPickerDialog((stack) => {
        updateFontStack(stack);
        configStore.set({ fontFamily: buildFontFamily(stack) });
        const desc = panel.querySelector("#set-font-family-desc");
        if (desc) desc.textContent = buildFontFamily(stack);
        // Notify parent for apply button state
        const evt = new CustomEvent("tterm-settings-changed");
        panel.dispatchEvent(evt);
      });
    });
  });

  return panel;
}

export function refreshAppearancePanel(root: HTMLElement): void {
  const fontDesc = root.querySelector("#set-font-family-desc");
  const sizeEl = root.querySelector("#set-font-size") as HTMLInputElement;
  if (fontDesc) fontDesc.textContent = configStore.get("fontFamily");
  if (sizeEl) sizeEl.value = String(configStore.get("fontSize"));
  root.dataset.themeName = configStore.get("themeName");
  renderThemeGallerySelection(root);
}

export function collectAppearanceSettings(root: HTMLElement): Partial<ConfigState> {
  const partial: Partial<ConfigState> = {};
  const sizeEl = root.querySelector("#set-font-size") as HTMLInputElement;
  if (sizeEl) partial.fontSize = Math.max(10, Math.min(32, parseInt(sizeEl.value, 10) || 14));
  partial.themeName = root.dataset.themeName || configStore.get("themeName");
  return partial;
}

export function renderThemeGallery(root: HTMLElement): void {
  const gallery = root.querySelector("#set-theme-gallery") as HTMLElement;
  if (!gallery) return;
  root.dataset.themeName = root.dataset.themeName || configStore.get("themeName");
  gallery.innerHTML = "";

  for (const t of allThemes()) {
    const th = t.theme;
    const card = document.createElement("div");
    card.className = "theme-card";
    card.dataset.theme = t.name;

    const preview = document.createElement("div");
    preview.className = "theme-card-preview";
    preview.style.background = th.background ?? "";
    preview.style.color = th.foreground ?? "";
    preview.style.fontFamily = configStore.get("fontFamily");

    const line = document.createElement("div");
    line.innerHTML = `$ ls <span style="color:${th.blue}">src/</span> <span style="color:${th.green}">run.sh</span> <span style="color:${th.red}">err.txt</span>`;
    preview.appendChild(line);

    const swatches = document.createElement("div");
    swatches.className = "theme-card-swatches";
    for (const c of [th.black, th.red, th.green, th.yellow, th.blue, th.magenta, th.cyan, th.white,
      th.brightBlack, th.brightRed, th.brightGreen, th.brightYellow, th.brightBlue, th.brightMagenta, th.brightCyan, th.brightWhite]) {
      const s = document.createElement("span");
      s.className = "theme-card-swatch";
      s.style.background = c ?? "transparent";
      swatches.appendChild(s);
    }
    preview.appendChild(swatches);
    card.appendChild(preview);

    const name = document.createElement("div");
    name.className = "theme-card-name";
    name.textContent = t.source === "wt" ? `${t.name} (WT)` : t.name;
    card.appendChild(name);

    card.addEventListener("click", () => {
      root.dataset.themeName = t.name;
      renderThemeGallerySelection(root);
      const evt = new CustomEvent("tterm-settings-changed");
      root.dispatchEvent(evt);
    });
    gallery.appendChild(card);
  }
  renderThemeGallerySelection(root);
}

export function renderThemeGallerySelection(root: HTMLElement): void {
  const current = root.dataset.themeName || configStore.get("themeName");
  root.querySelectorAll<HTMLElement>("#set-theme-gallery .theme-card").forEach(card => {
    card.classList.toggle("selected", card.dataset.theme === current);
  });
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
