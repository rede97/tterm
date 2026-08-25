// Settings — Appearance panel (lit-html)
// Font family, font size, color scheme gallery.
//
// lit-html panel (pilot: settings/ssh.ts): the panel renders through
// lit-html's diffing render()
// from store + per-panel state, so re-renders after a gallery click, a theme
// editor save, or a font pick patch DOM instead of rebuilding it. The pending
// gallery selection — root.dataset.themeName in the innerHTML era — is panel
// state now; the dataset attribute is still mirrored onto the settings-page
// root for the DOM contract (settings-theme tests read it).

import { dedupeThemeName } from "../config/custom-themes";
import { type ConfigState, configStore } from "../core/store";
import {
  html,
  itemRow,
  nothing,
  render,
  repeat,
  section,
  type TemplateResult,
  toggle,
} from "../ui/lit";
import { attachStepper } from "../ui/stepper";
import { buildFontFamily, updateFontStack } from "../util/fontconfig";
import { allThemes, DEFAULT_THEME_NAME, findTheme, type ThemeDef } from "../util/themes";
import { showThemeEditor } from "./themeeditor";

// ---- Per-panel state -------------------------------------------------
// Pending selection only — the applied theme stays in configStore (single
// source of truth). Per panel element so a second Settings page never
// inherits another's pending pick.

interface AppearancePanelState {
  // Pending gallery selection (applied by the shell's Apply; dropped on
  // Revert). null = follow the store. Replaces root.dataset.themeName.
  pendingThemeName: string | null;
  // Pending chrome skin / glass picks (same Apply/Revert lifecycle).
  pendingSkin: string | null;
  pendingGlass: boolean | null;
}

const panelStates = new WeakMap<HTMLElement, AppearancePanelState>();

function stateOf(panel: HTMLElement): AppearancePanelState {
  let st = panelStates.get(panel);
  if (!st) {
    st = { pendingThemeName: null, pendingSkin: null, pendingGlass: null };
    panelStates.set(panel, st);
  }
  return st;
}

function pendingThemeName(panel: HTMLElement): string {
  return stateOf(panel).pendingThemeName ?? configStore.get("themeName");
}

function appearancePanel(root: HTMLElement): HTMLElement | null {
  return root.querySelector<HTMLElement>('.settings-panel-content[data-panel="appearance"]');
}

// DOM contract: the pending selection is mirrored onto the settings-page
// root's dataset (settings-theme.test.ts reads root.dataset.themeName).
function mirrorPendingTheme(panel: HTMLElement): void {
  const page = panel.closest<HTMLElement>(".settings-page");
  if (page) page.dataset.themeName = pendingThemeName(panel);
}

export function createAppearancePanel(): HTMLElement {
  const panel = document.createElement("div");
  panel.className = "settings-panel-content";
  panel.dataset.panel = "appearance";
  panel.style.display = "none";
  renderPanel(panel);
  // Font size gets the shared stepper (native spinners are hidden globally).
  // attachStepper wraps the input in place; lit re-renders only touch dynamic
  // parts (which hold direct element references), so the stepper survives.
  const sizeInput = panel.querySelector<HTMLInputElement>("#set-font-size");
  if (sizeInput) attachStepper(sizeInput);
  return panel;
}

export function refreshAppearancePanel(root: HTMLElement): void {
  const panel = appearancePanel(root);
  if (!panel) return;
  stateOf(panel).pendingThemeName = null; // Revert drops the pending selection
  stateOf(panel).pendingSkin = null;
  stateOf(panel).pendingGlass = null;
  renderPanel(panel);
  // The size input is user-editable DOM: when the store value equals the last
  // rendered value lit leaves it alone, so reset it explicitly (Revert).
  const sizeEl = panel.querySelector<HTMLInputElement>("#set-font-size");
  if (sizeEl) sizeEl.value = String(configStore.get("fontSize"));
}

export function collectAppearanceSettings(root: HTMLElement): Partial<ConfigState> {
  const partial: Partial<ConfigState> = {};
  const sizeEl = root.querySelector("#set-font-size") as HTMLInputElement;
  if (sizeEl) partial.fontSize = Math.max(10, Math.min(32, parseInt(sizeEl.value, 10) || 14));
  const panel = appearancePanel(root);
  partial.themeName = panel
    ? pendingThemeName(panel)
    : root.dataset.themeName || configStore.get("themeName");
  if (panel) {
    partial.chromeSkin = stateOf(panel).pendingSkin ?? configStore.get("chromeSkin");
    partial.quickPanelGlass = stateOf(panel).pendingGlass ?? configStore.get("quickPanelGlass");
  }
  return partial;
}

/** Re-render the theme gallery (theme changes, editor saves). Same lit render
 *  path as the rest of the panel — only changed cards are patched. */
export function renderThemeGallery(root: HTMLElement): void {
  const panel = appearancePanel(root);
  if (panel) renderPanel(panel);
}

// ---- Rendering ---------------------------------------------------------

function renderPanel(panel: HTMLElement): void {
  mirrorPendingTheme(panel);
  render(appearanceTemplate(panel), panel);
}

function appearanceTemplate(panel: HTMLElement): TemplateResult {
  const current = pendingThemeName(panel);
  const skin = stateOf(panel).pendingSkin ?? configStore.get("chromeSkin");
  const skinCard = (id: string, title: string, desc: string): TemplateResult => html`
    <div
      class="skin-card ${skin === id ? "selected" : ""}"
      data-skin=${id}
      role="radio"
      aria-checked=${skin === id ? "true" : "false"}
      tabindex="0"
      @click=${() => selectSkin(panel, id)}
      @keydown=${(e: KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          selectSkin(panel, id);
        }
      }}
    >
      <div class="skin-card-title">${title}</div>
      <div class="skin-card-desc">${desc}</div>
    </div>
  `;
  return html`
    ${section(
      "Chrome Skin",
      html`
        <div class="settings-item-desc" style="margin-bottom:6px">
          Drives Settings / menus / quick panel. The tab bar stays fixed dark;
          terminal color schemes stay independent.
        </div>
        <div class="skin-grid" role="radiogroup" aria-label="Chrome skin">
          ${skinCard("cursor", "Cursor Mono", "Near-black, white CTA, soft radius")}
          ${skinCard("vscode", "VS Code Dark", "Blue accent, tighter chrome")}
        </div>
      `,
    )}
    ${section(
      "Quick Panel",
      itemRow(
        "Frosted glass",
        "Blur the terminal behind the panel only — the window stays opaque.",
        toggle(stateOf(panel).pendingGlass ?? configStore.get("quickPanelGlass"), (on) => {
          stateOf(panel).pendingGlass = on;
        }),
      ),
    )}
    ${section(
      "Font",
      html`
        <div class="settings-item settings-item-row">
          <div class="settings-item-info">
            <div class="settings-item-title">Font Family</div>
            <div class="settings-item-desc" id="set-font-family-desc">${configStore.get("fontFamily")}</div>
          </div>
          <div class="settings-item-control">
            <button
              id="set-font-config"
              class="settings-link-btn"
              @click=${() => openFontPicker(panel)}
            >Configure</button>
          </div>
        </div>
        ${itemRow(
          "Font Size",
          "Size of the terminal font in pixels.",
          html`<input
            type="number"
            id="set-font-size"
            class="settings-input settings-input-narrow"
            .value=${String(configStore.get("fontSize"))}
            min="10"
            max="32"
            step="1"
          />`,
        )}
      `,
    )}
    ${section(
      "Color Scheme",
      html`
        <div class="settings-item-desc" style="margin-bottom:6px">
          Click a card to choose. Windows Terminal schemes are imported automatically.
        </div>
        <div id="set-theme-gallery" class="theme-gallery">${galleryTemplate(panel, current)}</div>
      `,
    )}
  `;
}

function galleryTemplate(panel: HTMLElement, current: string): TemplateResult {
  const themes = allThemes();
  const builtin = themes.filter((t) => t.source !== "custom");
  const custom = themes.filter((t) => t.source === "custom");
  return html`
    <div class="theme-group-title">Built-in</div>
    <div class="theme-grid">
      ${repeat(
        builtin,
        (t) => t.name,
        (t) => themeCard(panel, t, current),
      )}
    </div>
    <div class="theme-group-title">Custom</div>
    <div class="theme-grid">
      ${repeat(
        custom,
        (t) => t.name,
        (t) => themeCard(panel, t, current),
      )}
      <button
        id="set-theme-new"
        class="settings-link-btn"
        @click=${() => openThemeEditor(panel, findTheme(pendingThemeName(panel)), undefined)}
      >+ New Theme</button>
    </div>
  `;
}

function themeCard(panel: HTMLElement, t: ThemeDef, current: string): TemplateResult {
  const th = t.theme;
  const swatchColors = [
    th.black,
    th.red,
    th.green,
    th.yellow,
    th.blue,
    th.magenta,
    th.cyan,
    th.white,
    th.brightBlack,
    th.brightRed,
    th.brightGreen,
    th.brightYellow,
    th.brightBlue,
    th.brightMagenta,
    th.brightCyan,
    th.brightWhite,
  ];
  return html`
    <div
      class="theme-card ${t.name === current ? "selected" : ""}"
      data-theme=${t.name}
      @click=${() => selectTheme(panel, t.name)}
    >
      <div
        class="theme-card-preview"
        style="background:${th.background ?? ""};color:${th.foreground ?? ""};font-family:${configStore.get("fontFamily")}"
      >
        <div>
          $ ls <span style="color:${th.blue}">src/</span>
          <span style="color:${th.green}">run.sh</span>
          <span style="color:${th.red}">err.txt</span>
        </div>
        <div class="theme-card-swatches">
          ${swatchColors.map(
            (c) =>
              html`<span class="theme-card-swatch" style="background:${c ?? "transparent"}"></span>`,
          )}
        </div>
      </div>
      <div class="theme-card-name">${t.source === "wt" ? `${t.name} (WT)` : t.name}</div>
      <div class="theme-card-actions">
        <button
          class="theme-card-action"
          @click=${(e: MouseEvent) => {
            e.stopPropagation();
            openThemeEditor(panel, t, undefined);
          }}
        >Duplicate</button>
        ${
          t.source === "custom"
            ? html`<button
              class="theme-card-action"
              @click=${(e: MouseEvent) => {
                e.stopPropagation();
                openThemeEditor(panel, t, t.name);
              }}
            >Edit</button>`
            : nothing
        }
      </div>
    </div>
  `;
}

// ---- Actions -----------------------------------------------------------

function selectTheme(panel: HTMLElement, name: string): void {
  stateOf(panel).pendingThemeName = name;
  renderPanel(panel);
  // The settings shell listens on the settings-page root; a bubbling event
  // from the panel reaches it and enables the footer Apply.
  panel.dispatchEvent(new CustomEvent("tterm-settings-changed", { bubbles: true }));
}

function selectSkin(panel: HTMLElement, id: string): void {
  stateOf(panel).pendingSkin = id;
  renderPanel(panel);
  panel.dispatchEvent(new CustomEvent("tterm-settings-changed", { bubbles: true }));
}

function openFontPicker(panel: HTMLElement): void {
  import("../ui/fontpicker").then((m) => {
    m.showFontPickerDialog((stack) => {
      updateFontStack(stack);
      configStore.set({ fontFamily: buildFontFamily(stack) });
      renderPanel(panel); // the family desc is bound to the store value
      // Notify the settings shell for apply button state.
      panel.dispatchEvent(new CustomEvent("tterm-settings-changed", { bubbles: true }));
    });
  });
}

/** Open the theme editor and reconcile the gallery/selection afterwards. */
function openThemeEditor(panel: HTMLElement, base: ThemeDef, editName: string | undefined): void {
  showThemeEditor({
    base,
    editName,
    suggestedName: editName ?? dedupeThemeName(`${base.name} Copy`),
    onSaved: (savedName) => {
      // Renaming the theme that is currently selected: follow the new name
      // everywhere (pending gallery selection + live terminals).
      // pendingThemeName() falls back to the store, covering both.
      if (editName && pendingThemeName(panel) === editName) {
        stateOf(panel).pendingThemeName = savedName;
      }
      // The saved theme is the live one: re-apply (colors may have changed
      // under the same name). set() re-notifies even for an unchanged value.
      const active = configStore.get("themeName");
      if (active === savedName || (editName && active === editName)) {
        configStore.set({ themeName: savedName });
      }
      renderPanel(panel);
    },
    onDeleted: (deletedName) => {
      // Deleted the active theme: fall back to the default.
      if (configStore.get("themeName") === deletedName) {
        configStore.set({ themeName: DEFAULT_THEME_NAME });
      }
      if (pendingThemeName(panel) === deletedName) {
        stateOf(panel).pendingThemeName = DEFAULT_THEME_NAME;
      }
      renderPanel(panel);
    },
  });
}
