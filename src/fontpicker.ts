import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { BUILTIN_FONTS, NERDFONT_BUILTIN, FontDef, fontStack, buildFontFamily, systemFontDefs } from "./fontconfig";
import { configFontSize } from "./profiles";

const NERDFONT_URL = "https://www.nerdfonts.com/";

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

export function showFontPickerDialog(
  onApply: (stack: string[]) => void
): void {
  const existing = document.querySelector(".font-picker-overlay");
  if (existing) existing.remove();

  const overlay = document.createElement("div");
  overlay.className = "font-picker-overlay";
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
            <a class="fp-nf-link" href="${NERDFONT_URL}" target="_blank">
              Install more Nerd Fonts →
            </a>
          </div>
        </div>
        <div class="fp-selected-section">
          <div class="fp-selected-title">Font Fallback Chain</div>
          <div class="fp-selected-list" id="fp-selected"></div>
        </div>
        <div class="fp-preview-section">
          <div class="fp-preview-title">Preview: <span id="fp-preview-font"></span></div>
          <div class="fp-preview-terminal" id="fp-preview"></div>
        </div>
      </div>
      <div class="font-picker-footer">
        <button class="fp-btn fp-btn-cancel">Cancel</button>
        <button class="fp-btn fp-btn-apply">Apply</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  // --- state ---
  let selected: string[] = [...fontStack];
  let previewFont: string | null = null; // font selected for individual preview
  let previewTerminal: Terminal | null = null;
  let previewFitAddon: FitAddon | null = null;

  // --- render lists ---
  const builtinList = overlay.querySelector("#fp-builtin")!;
  const systemList = overlay.querySelector("#fp-system")!;
  const selectedList = overlay.querySelector("#fp-selected")!;
  const searchInput = overlay.querySelector<HTMLInputElement>(".fp-search")!;
  const previewFontLabel = overlay.querySelector("#fp-preview-font")!;
  const systemCount = overlay.querySelector(".fp-system-count")!;
  const previewContainer = overlay.querySelector<HTMLElement>("#fp-preview")!;

  function isInUse(family: string): boolean {
    return selected.some(s => s.toLowerCase() === family.toLowerCase());
  }

  function renderFontItem(f: FontDef, listEl: Element): HTMLElement {
    const row = document.createElement("div");
    row.className = "fp-font-item";
    row.dataset.family = f.family;
    const inUse = isInUse(f.family);
    const isPreview = previewFont?.toLowerCase() === f.family.toLowerCase();
    if (isPreview) row.classList.add("preview-selected");

    let badge = "";
    if (f.source === "nerdfont") badge = `<span class="fp-badge nf">NF</span>`;
    else if (f.source === "builtin") badge = `<span class="fp-badge builtin">in</span>`;

    row.innerHTML = `
      <span class="fp-font-name">${f.label}</span>${badge}
      <button class="fp-font-add${inUse ? " in-use" : ""}" title="Add to font list">+</button>
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
    row.querySelector(".fp-font-add")!.addEventListener("click", (e) => {
      e.stopPropagation();
      if (isInUse(f.family)) {
        selected = selected.filter(s => s.toLowerCase() !== f.family.toLowerCase());
      } else {
        selected = [...selected, f.family];
      }
      refreshAll();
    });

    listEl.appendChild(row);
    return row;
  }

  function renderSelectedItem(family: string, idx: number): HTMLElement {
    const row = document.createElement("div");
    row.className = "fp-selected-item";
    row.dataset.family = family;

    const def = [...BUILTIN_FONTS, ...NERDFONT_BUILTIN, ...systemFontDefs()]
      .find(f => f.family.toLowerCase() === family.toLowerCase());

    row.innerHTML = `
      <span class="fp-selected-name">${def?.label ?? family}</span>
      <span class="fp-remove-btn" data-family="${family}">×</span>
      <span class="fp-move-btns">
        <button class="fp-move-btn fp-move-up" ${idx === 0 ? "disabled" : ""}>▲</button>
        <button class="fp-move-btn fp-move-down" ${idx === selected.length - 1 ? "disabled" : ""}>▼</button>
      </span>
    `;

    row.querySelector(".fp-remove-btn")!.addEventListener("click", (e) => {
      e.stopPropagation();
      selected = selected.filter(s => s.toLowerCase() !== family.toLowerCase());
      refreshAll();
    });

    row.querySelector(".fp-move-up")?.addEventListener("click", (e) => {
      e.stopPropagation();
      if (idx > 0) {
        const [item] = selected.splice(idx, 1);
        selected.splice(idx - 1, 0, item);
        refreshAll();
      }
    });

    row.querySelector(".fp-move-down")?.addEventListener("click", (e) => {
      e.stopPropagation();
      if (idx < selected.length - 1) {
        const [item] = selected.splice(idx, 1);
        selected.splice(idx + 1, 0, item);
        refreshAll();
      }
    });

    return row;
  }

  function refreshLists() {
    const query = searchInput.value.trim().toLowerCase();

    builtinList.innerHTML = "";
    let allBuiltin = [...BUILTIN_FONTS, ...NERDFONT_BUILTIN];
    if (query) {
      allBuiltin = allBuiltin.filter(f =>
        f.family.toLowerCase().includes(query) || f.label.toLowerCase().includes(query)
      );
    }
    allBuiltin.forEach(f => renderFontItem(f, builtinList));

    systemList.innerHTML = "";
    let sysFonts = systemFontDefs();
    systemCount.textContent = sysFonts.length > 0 ? `(${sysFonts.length})` : "(loading...)";
    if (query) {
      sysFonts = sysFonts.filter(f => f.family.toLowerCase().includes(query));
    }
    sysFonts.forEach(f => renderFontItem(f, systemList));
  }

  function refreshSelected() {
    selectedList.innerHTML = "";
    selected.forEach((family, idx) => {
      selectedList.appendChild(renderSelectedItem(family, idx));
    });
  }

  function updatePreview() {
    if (!previewTerminal || !previewFitAddon) return;
    if (previewFont) {
      const css = `'${previewFont}', monospace`;
      previewTerminal.options.fontFamily = css;
      previewFontLabel.textContent = previewFont;
    } else {
      const css = buildFontFamily(selected);
      previewTerminal.options.fontFamily = css;
      previewFontLabel.textContent = css;
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
      fontSize: configFontSize,
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
    previewFontLabel.textContent = buildFontFamily(selected);
  }

  // --- buttons ---
  overlay.querySelector(".fp-btn-cancel")!.addEventListener("click", () => {
    previewTerminal?.dispose();
    overlay.remove();
  });
  overlay.querySelector(".fp-btn-apply")!.addEventListener("click", () => {
    if (selected.length === 0) return;
    onApply(selected);
    previewTerminal?.dispose();
    overlay.remove();
  });
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) {
      previewTerminal?.dispose();
      overlay.remove();
    }
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
