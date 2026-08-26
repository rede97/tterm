import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import Sortable from "sortablejs";
import { esc } from "../core/common";
import { configStore } from "../core/store";
import { mustQuery } from "../ui/dom";
import { createModal } from "../ui/modal";
import {
  BUILTIN_FONTS,
  buildFontFamily,
  type FontDef,
  parseFontFamily,
  systemFontDefs,
} from "../util/fontconfig";

const NERDFONT_URL = "https://www.nerdfonts.com/";

// Design (settings-preview font picker): small + / ✓ (12px), quiet chrome.
const ICO_PLUS = `<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M8 3.5v9M3.5 8h9"/></svg>`;
const ICO_CHECK = `<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M3.5 8.2 6.6 11.2 12.5 4.8"/></svg>`;

const PREVIEW_CONTENT = [
  "\x1b[32muser@host\x1b[0m:\x1b[34m~/projects\x1b[0m$ ls -la",
  "total 128",
  "drwxr-xr-x  12 user  staff   384 May 18 10:30 \x1b[34m.\x1b[0m",
  "drwxr-xr-x   5 user  staff   160 May 17 09:15 \x1b[34m..\x1b[0m",
  "-rw-r--r--   1 user  staff  2048 May 16 22:01 \x1b[31mREADME.md\x1b[0m",
  "drwxr-xr-x   3 user  staff    96 May 15 14:22 \x1b[34msrc\x1b[0m",
  "",
  "\x1b[33m●\x1b[0m Build \x1b[32mpassed\x1b[0m in 2.4s",
  "\x1b[31m✗\x1b[0m Test \x1b[31mfailed\x1b[0m: 1/42",
  "",
  "abcdefghijklmnopqrstuvwxyz 0123456789",
  "Hello, 世界！你好，世界！",
  "한국어: 안녕하세요 세계! 日本語: こんにちは世界！",
  "       ← Nerd Font icons",
].join("\r\n");

export function showFontPickerDialog(onApply: (stack: string[]) => void): void {
  const modal = createModal({
    className: "font-picker-overlay",
    onClose: () => previewTerminal?.dispose(),
  });
  const overlay = modal.overlay;
  overlay.innerHTML = `
    <div class="font-picker">
      <div class="font-picker-header">Font Settings</div>
      <div class="font-picker-body">
        <div class="fp-search-row">
          <input type="text" class="fp-search" placeholder="Search fonts..." />
        </div>
        <div class="fp-lists">
          <div class="fp-list-col">
            <div class="fp-list-title">Built-in</div>
            <div class="fp-list" id="fp-builtin"></div>
          </div>
          <div class="fp-list-col">
            <div class="fp-list-title">
              System
              <span class="fp-system-count"></span>
            </div>
            <div class="fp-list" id="fp-system"></div>
          </div>
        </div>
        <div class="fp-selected-section">
          <div class="fp-selected-title">Font Fallback Chain</div>
          <div class="fp-selected-list" id="fp-selected"></div>
        </div>
        <div class="fp-preview-section">
          <div class="fp-preview-terminal" id="fp-preview"></div>
        </div>
      </div>
      <div class="font-picker-footer">
        <a class="fp-nf-link" href="${NERDFONT_URL}" target="_blank" rel="noopener">Install more Nerd Fonts →</a>
        <div class="font-picker-footer-actions">
          <button type="button" class="tt-btn tt-btn-ghost fp-btn-cancel">Cancel</button>
          <button type="button" class="tt-btn tt-btn-primary fp-btn-apply">Apply</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  // --- state ---
  // Initialize from the current font stack parsed from configStore
  let selected: string[] = parseFontFamily(configStore.get("fontFamily"));
  let previewFont: string | null = null; // font selected for individual preview
  let previewTerminal: Terminal | null = null;
  let previewFitAddon: FitAddon | null = null;

  // --- render lists ---
  const builtinList = mustQuery(overlay, "#fp-builtin");
  const systemList = mustQuery(overlay, "#fp-system");
  const selectedList = mustQuery<HTMLElement>(overlay, "#fp-selected");
  const searchInput = mustQuery<HTMLInputElement>(overlay, ".fp-search");
  const systemCount = mustQuery(overlay, ".fp-system-count");
  const previewContainer = mustQuery<HTMLElement>(overlay, "#fp-preview");

  function isInUse(family: string): boolean {
    return selected.some((s) => s.toLowerCase() === family.toLowerCase());
  }

  function renderFontItem(f: FontDef, listEl: Element): HTMLElement {
    const row = document.createElement("div");
    row.className = "fp-font-item";
    row.dataset.family = f.family;
    const inUse = isInUse(f.family);
    const isPreview = previewFont?.toLowerCase() === f.family.toLowerCase();
    if (isPreview) row.classList.add("preview-selected");

    const badge = f.source === "builtin" ? `<span class="fp-badge builtin">in</span>` : "";

    // Names render in their own typeface (design); in-use shows a check.
    row.innerHTML = `
      <span class="fp-font-name" style="font-family:'${esc(f.family)}',monospace">${esc(f.label)}</span>${badge}
      <button type="button" class="fp-font-add${inUse ? " in-use" : ""}" title="${inUse ? "Remove from font list" : "Add to font list"}">${inUse ? ICO_CHECK : ICO_PLUS}</button>
    `;

    // click font name → select for preview
    row.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      if (target.closest(".fp-font-add")) return;
      if (previewFont?.toLowerCase() === f.family.toLowerCase()) {
        previewFont = null;
      } else {
        previewFont = f.family;
      }
      refreshAll();
    });

    // + button → add/remove from used list
    row.querySelector(".fp-font-add")?.addEventListener("click", (e) => {
      e.stopPropagation();
      if (isInUse(f.family)) {
        selected = selected.filter((s) => s.toLowerCase() !== f.family.toLowerCase());
      } else {
        selected = [...selected, f.family];
      }
      refreshAll();
    });

    listEl.appendChild(row);
    return row;
  }

  function renderSelectedItem(family: string): HTMLElement {
    const row = document.createElement("div");
    row.className = "fp-selected-item";
    row.dataset.family = family;

    const def = [...BUILTIN_FONTS, ...systemFontDefs()].find(
      (f) => f.family.toLowerCase() === family.toLowerCase(),
    );

    row.innerHTML = `
      <span class="fp-drag-grip" title="Drag to reorder">⠿</span>
      <span class="fp-selected-name" style="font-family:'${esc(family)}',monospace">${esc(def?.label ?? family)}</span>
      <button type="button" class="fp-remove-btn" title="Remove" data-family="${esc(family)}">×</button>
    `;

    row.querySelector(".fp-remove-btn")?.addEventListener("click", (e) => {
      e.stopPropagation();
      selected = selected.filter((s) => s.toLowerCase() !== family.toLowerCase());
      refreshAll();
    });

    return row;
  }

  function refreshLists() {
    const query = searchInput.value.trim().toLowerCase();

    builtinList.innerHTML = "";
    let allBuiltin = BUILTIN_FONTS;
    if (query) {
      allBuiltin = allBuiltin.filter(
        (f) => f.family.toLowerCase().includes(query) || f.label.toLowerCase().includes(query),
      );
    }
    allBuiltin.forEach((f) => {
      renderFontItem(f, builtinList);
    });

    systemList.innerHTML = "";
    let sysFonts = systemFontDefs();
    systemCount.textContent = sysFonts.length > 0 ? `(${sysFonts.length})` : "(loading...)";
    if (query) {
      sysFonts = sysFonts.filter((f) => f.family.toLowerCase().includes(query));
    }
    sysFonts.forEach((f) => {
      renderFontItem(f, systemList);
    });
  }

  function refreshSelected() {
    selectedList.innerHTML = "";
    selected.forEach((family) => {
      selectedList.appendChild(renderSelectedItem(family));
    });
  }

  // Drag-to-reorder the fallback chain — same Sortable setup as the tab bar
  // (forceFallback: native HTML5 DnD is unreliable in WebView2). Bound once
  // on the container; refreshSelected only swaps children, which is fine.
  new Sortable(selectedList, {
    animation: 150,
    forceFallback: true,
    fallbackTolerance: 5,
    filter: ".fp-remove-btn",
    preventOnFilter: false,
    onEnd: () => {
      // Sortable already reordered the DOM; adopt it as the source of truth,
      // then re-render so rows keep their × wiring.
      selected = [...selectedList.children].flatMap((el) => {
        const family = (el as HTMLElement).dataset.family;
        return family ? [family] : [];
      });
      refreshSelected();
      updatePreview();
    },
  });

  function updatePreview() {
    if (!previewTerminal || !previewFitAddon) return;
    if (previewFont) {
      previewTerminal.options.fontFamily = `'${previewFont}', monospace`;
    } else {
      previewTerminal.options.fontFamily = buildFontFamily(selected);
    }

    previewTerminal.reset();
    previewFitAddon.fit();
    previewTerminal.writeln(PREVIEW_CONTENT);
  }

  function refreshAll() {
    refreshLists();
    refreshSelected();
    updatePreview();
  }

  // --- preview terminal ---
  function initPreview() {
    const term = new Terminal({
      cursorBlink: false,
      fontSize: configStore.get("fontSize"),
      fontFamily: buildFontFamily(selected),
      scrollback: 5000,
      disableStdin: true,
      theme: {
        background: "#1e1e1e",
        foreground: "#d4d4d4",
        cursor: "#ffffff",
        black: "#000000",
        red: "#cd3131",
        green: "#0dbc79",
        yellow: "#e5e510",
        blue: "#2472c8",
        magenta: "#bc3fbc",
        cyan: "#11a8cd",
        white: "#e5e5e5",
        brightBlack: "#666666",
        brightRed: "#f14c4c",
        brightGreen: "#23d18b",
        brightYellow: "#f5f543",
        brightBlue: "#3b8eea",
        brightMagenta: "#d670d6",
        brightCyan: "#29b8db",
        brightWhite: "#ffffff",
      },
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(previewContainer);
    fitAddon.fit();
    term.writeln(PREVIEW_CONTENT);
    previewTerminal = term;
    previewFitAddon = fitAddon;
  }

  // --- buttons --- (Escape/backdrop also close, via createModal)
  overlay.querySelector(".fp-btn-cancel")?.addEventListener("click", modal.close);
  overlay.querySelector(".fp-btn-apply")?.addEventListener("click", () => {
    if (selected.length === 0) return;
    onApply(selected);
    modal.close();
  });

  // --- init ---
  refreshLists();
  refreshSelected();
  initPreview();
  searchInput.addEventListener("input", () => {
    refreshLists();
  });
  searchInput.focus();
}
