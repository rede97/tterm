// Settings — Appearance panel
// Font family, font size, color scheme gallery

import { configStore, type ConfigState } from "../core/store";
import { buildFontFamily, updateFontStack } from "../util/fontconfig";
import { allThemes, findTheme, DEFAULT_THEME_NAME, type ThemeDef } from "../util/themes";
import { dedupeThemeName } from "../config/custom-themes";
import { showThemeEditor } from "./themeeditor";

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

  const renderCard = (t: ThemeDef, grid: HTMLElement) => {
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

    // Card actions: duplicate any theme into a custom copy; custom themes
    // can also be edited. Clicks must not select the card.
    const actions = document.createElement("div");
    actions.className = "theme-card-actions";
    const dupBtn = document.createElement("button");
    dupBtn.className = "theme-card-action";
    dupBtn.textContent = "Duplicate";
    dupBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openThemeEditor(root, t, undefined);
    });
    actions.appendChild(dupBtn);
    if (t.source === "custom") {
      const editBtn = document.createElement("button");
      editBtn.className = "theme-card-action";
      editBtn.textContent = "Edit";
      editBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        openThemeEditor(root, t, t.name);
      });
      actions.appendChild(editBtn);
    }
    card.appendChild(actions);

    card.addEventListener("click", () => {
      root.dataset.themeName = t.name;
      renderThemeGallerySelection(root);
      const evt = new CustomEvent("tterm-settings-changed");
      root.dispatchEvent(evt);
    });
    grid.appendChild(card);
  };

  const themes = allThemes();
  const builtin = themes.filter((t) => t.source !== "custom");
  const custom = themes.filter((t) => t.source === "custom");

  // Built-in (and imported WT) schemes.
  const builtinHeader = document.createElement("div");
  builtinHeader.className = "theme-group-title";
  builtinHeader.textContent = "Built-in";
  gallery.appendChild(builtinHeader);
  const builtinGrid = document.createElement("div");
  builtinGrid.className = "theme-grid";
  for (const t of builtin) renderCard(t, builtinGrid);
  gallery.appendChild(builtinGrid);

  // User's own themes (themes.json) — always shown so the affordance exists.
  const customHeader = document.createElement("div");
  customHeader.className = "theme-group-title";
  customHeader.textContent = "Custom";
  gallery.appendChild(customHeader);
  const customGrid = document.createElement("div");
  customGrid.className = "theme-grid";
  for (const t of custom) renderCard(t, customGrid);

  // "New Theme" — duplicate the currently selected theme as a starting point.
  const newBtn = document.createElement("button");
  newBtn.id = "set-theme-new";
  newBtn.className = "settings-link-btn";
  newBtn.textContent = "+ New Theme";
  newBtn.addEventListener("click", () => {
    const base = findTheme(root.dataset.themeName);
    openThemeEditor(root, base, undefined);
  });
  customGrid.appendChild(newBtn);
  gallery.appendChild(customGrid);

  renderThemeGallerySelection(root);
}

/** Open the theme editor and reconcile the gallery/selection afterwards. */
function openThemeEditor(root: HTMLElement, base: ThemeDef, editName: string | undefined): void {
  showThemeEditor({
    base,
    editName,
    suggestedName: editName ?? dedupeThemeName(`${base.name} Copy`),
    onSaved: (savedName) => {
      // Renaming the theme that is currently selected: follow the new name
      // everywhere (pending gallery selection + live terminals).
      if (editName && (root.dataset.themeName === editName || configStore.get("themeName") === editName)) {
        root.dataset.themeName = savedName;
      }
      // The saved theme is the live one: re-apply (colors may have changed
      // under the same name). set() re-notifies even for an unchanged value.
      const active = configStore.get("themeName");
      if (active === savedName || (editName && active === editName)) {
        configStore.set({ themeName: savedName });
      }
      renderThemeGallery(root);
    },
    onDeleted: (deletedName) => {
      // Deleted the active theme: fall back to the default.
      if (configStore.get("themeName") === deletedName) {
        configStore.set({ themeName: DEFAULT_THEME_NAME });
      }
      if (root.dataset.themeName === deletedName) {
        root.dataset.themeName = DEFAULT_THEME_NAME;
      }
      renderThemeGallery(root);
    },
  });
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
