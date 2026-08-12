// Theme editor modal — create a custom theme from any existing one
// ("Duplicate") or edit an existing custom theme. Themes persist in
// themes.json via config/custom-themes.ts, never in config.json.

import type { ITheme } from "@xterm/xterm";
import {
  deleteCustomTheme,
  sanitizeTheme,
  saveCustomTheme,
  THEME_COLOR_KEYS,
} from "../config/custom-themes";
import { logCatch } from "../core/errorlog";
import { createModal } from "../ui/modal";
import { showToast } from "../ui/toast";
import { allThemes, type ThemeDef } from "../util/themes";

const COLOR_LABELS: Record<string, string> = {
  background: "Background",
  foreground: "Foreground",
  cursor: "Cursor",
  cursorAccent: "Cursor text",
  selectionBackground: "Selection",
};

const FALLBACK_COLORS: Record<string, string> = {
  background: "#1e1e1e",
  foreground: "#d4d4d4",
  cursor: "#ffffff",
  cursorAccent: "#000000",
  selectionBackground: "#264f78",
};

export interface ThemeEditorOptions {
  // Theme the editor starts from (duplicate source, or the edited theme).
  base: ThemeDef;
  // Set when editing an existing custom theme (enables rename + delete).
  editName?: string;
  // Initial name for the copy (already deduped by the caller).
  suggestedName: string;
  onSaved: (savedName: string) => void;
  onDeleted?: (deletedName: string) => void;
}

function colorRow(key: string, value: string): string {
  const label = COLOR_LABELS[key] ?? key;
  return `
    <label class="te-row">
      <span class="te-label">${label}</span>
      <input type="color" class="te-color" data-key="${key}" value="${value}" />
      <input type="text" class="te-hex" data-key="${key}" value="${value}" spellcheck="false" />
    </label>`;
}

export function showThemeEditor(opts: ThemeEditorOptions): void {
  const working: Record<string, string> = {};
  for (const key of THEME_COLOR_KEYS) {
    working[key] =
      (opts.base.theme as Record<string, string | undefined>)[key] ??
      FALLBACK_COLORS[key] ??
      "#000000";
  }

  const coreRows = ["background", "foreground", "cursor", "cursorAccent", "selectionBackground"]
    .map((k) => colorRow(k, working[k]))
    .join("");
  const paletteRows = THEME_COLOR_KEYS.slice(5)
    .map((k) => colorRow(k, working[k]))
    .join("");

  const modal = createModal({ className: "te-overlay" });
  const overlay = modal.overlay;
  overlay.innerHTML = `
    <div class="te-dialog">
      <div class="te-header">${opts.editName ? "Edit Theme" : "New Theme"}</div>
      <div class="te-name-row">
        <span class="te-label">Name</span>
        <input type="text" class="te-name" value="${opts.suggestedName.replace(/"/g, "&quot;")}" spellcheck="false" />
      </div>
      <div class="te-preview"></div>
      <div class="te-columns">
        <div class="te-group"><div class="te-group-title">Core</div>${coreRows}</div>
        <div class="te-group"><div class="te-group-title">Palette</div>${paletteRows}</div>
      </div>
      <div class="te-footer">
        ${opts.editName ? `<button class="te-btn te-delete">Delete</button>` : ""}
        <span class="te-spacer"></span>
        <button class="te-btn te-cancel">Cancel</button>
        <button class="te-btn te-save">Save</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const nameInput = overlay.querySelector<HTMLInputElement>(".te-name")!;
  const preview = overlay.querySelector<HTMLElement>(".te-preview")!;

  function renderPreview(): void {
    preview.style.background = working.background;
    preview.style.color = working.foreground;
    preview.innerHTML = "";
    const line = document.createElement("div");
    line.innerHTML = `$ ls <span style="color:${working.blue}">src/</span> <span style="color:${working.green}">run.sh</span> <span style="color:${working.red}">err.txt</span>`;
    preview.appendChild(line);
    const swatches = document.createElement("div");
    swatches.className = "te-swatches";
    for (const key of THEME_COLOR_KEYS.slice(5)) {
      const s = document.createElement("span");
      s.className = "te-swatch";
      s.style.background = working[key];
      swatches.appendChild(s);
    }
    preview.appendChild(swatches);
  }

  function syncColor(key: string, value: string, from: "picker" | "hex"): void {
    if (!/^#[0-9a-fA-F]{6}$/.test(value)) return; // ignore partial hex input
    working[key] = value;
    const other = overlay.querySelector<HTMLInputElement>(
      from === "picker" ? `.te-hex[data-key="${key}"]` : `.te-color[data-key="${key}"]`,
    );
    if (other && other.value !== value) other.value = value;
    renderPreview();
  }

  overlay.querySelectorAll<HTMLInputElement>(".te-color").forEach((el) => {
    el.addEventListener("input", () => syncColor(el.dataset.key!, el.value, "picker"));
  });
  overlay.querySelectorAll<HTMLInputElement>(".te-hex").forEach((el) => {
    el.addEventListener("input", () => syncColor(el.dataset.key!, el.value.trim(), "hex"));
  });

  const close = modal.close;
  overlay.querySelector(".te-cancel")?.addEventListener("click", close);

  overlay.querySelector(".te-save")?.addEventListener("click", () => {
    const name = nameInput.value.trim();
    if (!name) {
      showToast("Theme name cannot be empty", "error");
      return;
    }
    // Name must not collide with a different theme.
    const collision = allThemes().some((t) => t.name === name && t.name !== opts.editName);
    if (collision) {
      showToast(`A theme named "${name}" already exists`, "error");
      return;
    }
    const theme = sanitizeTheme(working);
    if (!theme) {
      showToast("Background and foreground colors are required", "error");
      return;
    }
    saveCustomTheme(name, theme as ITheme, opts.editName)
      .then(() => {
        opts.onSaved(name);
        close();
      })
      .catch((e) => showToast(`Failed to save theme: ${e}`, "error"));
  });

  overlay.querySelector(".te-delete")?.addEventListener("click", () => {
    if (!opts.editName) return;
    if (!confirm(`Delete theme "${opts.editName}"?`)) return;
    deleteCustomTheme(opts.editName)
      .then(() => {
        opts.onDeleted?.(opts.editName!);
        close();
      })
      .catch(logCatch("themeEditor.delete"));
  });

  renderPreview();
  nameInput.focus();
  nameInput.select();
}
