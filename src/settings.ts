import { localProfiles, configFontFamily, configFontSize, hiddenProfiles, configPasteWarning, configPasteTrim, configTerminalBell, configRenderer, configScrollback, configTabWidthMode, configThemeName, configSerialBaud, configSerialInputMode, configSerialOutputNewline, saveConfig, loadConfig, sshHosts, loadSshHosts, hiddenSshHosts, SshHost, hostProp, serialPorts, loadSerialPorts, serialPortParams, rememberSerialParams, forgetSerialParams, serialKeyFor, SERIAL_BAUD_RATES, SERIAL_OUTPUT_NEWLINES, SerialInputMode, SerialOutputNewline } from "./profiles";
import { allThemes } from "./themes";
import { buildFontFamily, updateFontStack, parseFontFamily } from "./fontconfig";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";

import { settingsChangedFn } from "./settings-events";
import { showToast } from "./toast";

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

  const navSsh = document.createElement("button");
  navSsh.className = "settings-nav-item";
  navSsh.textContent = "SSH";
  navSsh.dataset.panel = "ssh";

  const navSerial = document.createElement("button");
  navSerial.className = "settings-nav-item";
  navSerial.textContent = "Serial";
  navSerial.dataset.panel = "serial";

  sidebar.appendChild(navGeneral);
  sidebar.appendChild(navAppearance);
  sidebar.appendChild(navProfile);
  sidebar.appendChild(navSsh);
  sidebar.appendChild(navSerial);
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
    updateFontStack(parseFontFamily(configFontFamily));
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
          <div class="settings-item-desc" id="set-font-family-desc">${esc(configFontFamily)}</div>
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
          <input type="number" id="set-font-size" class="settings-input settings-input-narrow" value="${configFontSize}" min="10" max="32" step="1" />
        </div>
      </div>
    </div>
    <div class="settings-section">
      <div class="settings-section-title">Color Scheme</div>
      <div class="settings-item-desc" style="margin-bottom:6px">Click a card to choose. Windows Terminal schemes are imported automatically.</div>
      <div id="set-theme-gallery" class="theme-gallery"></div>
    </div>
  `;
  body.appendChild(panelAppearance);

  // Font config button — opens font picker
  panelAppearance.querySelector("#set-font-config")!.addEventListener("click", () => {
    import("./fontpicker").then(m => {
      m.showFontPickerDialog((stack) => {
        updateFontStack(stack);
        saveConfig({ fontFamily: buildFontFamily(stack) });
        const desc = root.querySelector("#set-font-family-desc");
        if (desc) desc.textContent = buildFontFamily(stack);
        const cb = settingsChangedFn();
        if (cb) cb();
        const fb = root.querySelector(".settings-feedback")!;
        fb.textContent = "Font updated";
        fb.className = "settings-feedback settings-feedback-ok";
        setTimeout(() => { fb.textContent = ""; }, 2000);
      });
    });
  });

  // Profile panel
  const panelProfile = document.createElement("div");
  panelProfile.className = "settings-panel-content";
  panelProfile.dataset.panel = "profile";
  panelProfile.style.display = "none";
  renderWtPanel(panelProfile);
  body.appendChild(panelProfile);

  // SSH panel
  const panelSsh = document.createElement("div");
  panelSsh.className = "settings-panel-content";
  panelSsh.dataset.panel = "ssh";
  panelSsh.style.display = "none";
  renderSshPanel(panelSsh);
  body.appendChild(panelSsh);

  // Serial panel
  const panelSerial = document.createElement("div");
  panelSerial.className = "settings-panel-content";
  panelSerial.dataset.panel = "serial";
  panelSerial.style.display = "none";
  renderSerialPanel(panelSerial);
  body.appendChild(panelSerial);

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
    updateFontStack(parseFontFamily(configFontFamily));
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

  renderThemeGallery(root, applyBtn);

  return root;
}

function refreshForm(root: HTMLElement) {
  const fontDesc = root.querySelector("#set-font-family-desc");
  const sizeEl = root.querySelector("#set-font-size") as HTMLInputElement;
  const profileEl = root.querySelector("#set-default-profile") as HTMLSelectElement;
  const pasteWarnEl = root.querySelector("#set-paste-warning") as HTMLInputElement;
  const bellEl = root.querySelector("#set-bell") as HTMLInputElement;
  const checks = root.querySelectorAll<HTMLInputElement>(".wt-profile-check");

  if (fontDesc) fontDesc.textContent = configFontFamily;
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
  root.dataset.themeName = configThemeName;
  renderThemeGallerySelection(root);
  const baudEl = root.querySelector("#set-serial-baud") as HTMLSelectElement;
  if (baudEl) baudEl.value = String(configSerialBaud);
  const modeEl = root.querySelector("#set-serial-input-mode") as HTMLSelectElement;
  if (modeEl) modeEl.value = configSerialInputMode;
  const nlEl = root.querySelector("#set-serial-output-newline") as HTMLSelectElement;
  if (nlEl) nlEl.value = configSerialOutputNewline;
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

export function generateSshConfig(hosts: SshHost[]): string {
  const lines: string[] = [];
  lines.push("# Generated by TTerm. Original backed up to config.tt.bak");
  lines.push("");
  for (const h of hosts) {
    lines.push(`Host ${h.name}`);
    const ordered = ["hostname", "user", "port"];
    const written = new Set<string>();
    for (const lk of ordered) {
      const origKey = Object.keys(h).find(k => k !== "name" && k.toLowerCase() === lk);
      if (origKey) {
        lines.push(`    ${origKey} ${h[origKey]}`);
        written.add(origKey);
      }
    }
    for (const [k, v] of Object.entries(h)) {
      if (k === "name" || written.has(k)) continue;
      lines.push(`    ${k} ${v}`);
    }
    lines.push("");
  }
  return lines.join("\n") + "\n";
}

function baudOptionsHtml(current: number): string {
  return SERIAL_BAUD_RATES.map(b =>
    `<option value="${b}" ${current === b ? "selected" : ""}>${b}</option>`).join("");
}

function inputModeOptionsHtml(current: SerialInputMode): string {
  const modes: [SerialInputMode, string][] = [["normal", "Normal"], ["echo", "Echo"], ["line", "Line by Line"]];
  return modes.map(([v, label]) =>
    `<option value="${v}" ${current === v ? "selected" : ""}>${label}</option>`).join("");
}

function outputNewlineOptionsHtml(current: string): string {
  return SERIAL_OUTPUT_NEWLINES.map(([v, label]) =>
    `<option value="${v}" ${current === v ? "selected" : ""}>${label}</option>`).join("");
}

function renderSerialPanel(container: HTMLElement) {
  container.innerHTML = `
    <div class="settings-section">
      <div class="settings-section-title">Defaults</div>
      <div class="settings-item settings-item-row">
        <div class="settings-item-info">
          <div class="settings-item-title">Default baud rate</div>
          <div class="settings-item-desc">Baud rate for ports without remembered settings (8N1, no flow control).</div>
        </div>
        <div class="settings-item-control">
          <select id="set-serial-baud" class="settings-select">${baudOptionsHtml(configSerialBaud)}</select>
        </div>
      </div>
      <div class="settings-item settings-item-row">
        <div class="settings-item-info">
          <div class="settings-item-title">Default input mode</div>
          <div class="settings-item-desc">Normal: send keys directly. ECHO: also echo locally. Line by Line: edit locally, send whole line on Enter.</div>
        </div>
        <div class="settings-item-control">
          <select id="set-serial-input-mode" class="settings-select">${inputModeOptionsHtml(configSerialInputMode)}</select>
        </div>
      </div>
      <div class="settings-item settings-item-row">
        <div class="settings-item-info">
          <div class="settings-item-title">Default output newlines</div>
          <div class="settings-item-desc">How device output line endings are rewritten before display.</div>
        </div>
        <div class="settings-item-control">
          <select id="set-serial-output-newline" class="settings-select">${outputNewlineOptionsHtml(configSerialOutputNewline)}</select>
        </div>
      </div>
    </div>
    <div class="settings-section">
      <div class="settings-section-title">Connected Ports</div>
      <div id="serial-port-list">
        <div class="settings-item-desc">Enumerating…</div>
      </div>
    </div>
    <div class="settings-section">
      <div class="settings-section-title">History</div>
      <div id="serial-history-list"></div>
    </div>
  `;

  const listEl = container.querySelector("#serial-port-list")!;
  const historyEl = container.querySelector("#serial-history-list")!;

  const renderHistory = () => {
    const keys = Object.keys(serialPortParams);
    if (keys.length === 0) {
      historyEl.innerHTML = `<div class="settings-item-desc">No remembered port settings.</div>`;
      return;
    }
    historyEl.innerHTML = keys.map(key => {
      const p = serialPortParams[key];
      const label = key.startsWith("usb:") ? `USB ${key.slice(4)}` : key.slice(4);
      return `
        <div class="settings-item settings-item-row serial-history-row" data-key="${esc(key)}">
          <div class="settings-item-info">
            <div class="settings-item-title">${esc(label)}</div>
            <div class="settings-item-desc">${p.baud} baud · ${esc(p.inputMode ?? "normal")} · ${esc(p.outputNewline ?? "keep")}</div>
          </div>
          <div class="settings-item-control">
            <button class="settings-link-btn serial-history-forget" data-key="${esc(key)}">Forget</button>
          </div>
        </div>`;
    }).join("");
    historyEl.querySelectorAll<HTMLButtonElement>(".serial-history-forget").forEach(btn => {
      btn.addEventListener("click", async () => {
        await forgetSerialParams(btn.dataset.key!);
        renderHistory();
        showToast(`Forgot ${btn.dataset.key}`, "info", 1500);
      });
    });
  };
  renderHistory();

  loadSerialPorts().then(() => {
    if (serialPorts.length === 0) {
      listEl.innerHTML = `<div class="settings-item-desc">No serial devices detected.</div>`;
      return;
    }
    listEl.innerHTML = serialPorts.map(p => {
      const ids = p.vid && p.pid ? `${p.vid}:${p.pid}` : "";
      const sub = [p.product || p.driver, p.manufacturer, ids].filter(Boolean).join(" · ");
      const key = serialKeyFor(p);
      const mem = serialPortParams[key];
      const baud = mem?.baud ?? configSerialBaud;
      const mode = mem?.inputMode ?? configSerialInputMode;
      const nl = mem?.outputNewline ?? configSerialOutputNewline;
      return `
        <div class="settings-item settings-item-row serial-port-row">
          <div class="settings-item-info">
            <div class="settings-item-title">${esc(p.name)}</div>
            <div class="settings-item-desc">${esc(sub)}</div>
          </div>
          <div class="settings-item-control" style="display:flex;gap:6px;">
            <select class="settings-select serial-port-baud" data-key="${esc(key)}">
              ${baudOptionsHtml(baud)}
            </select>
            <select class="settings-select serial-port-mode" data-key="${esc(key)}">
              ${inputModeOptionsHtml(mode)}
            </select>
            <select class="settings-select serial-port-nl" data-key="${esc(key)}">
              ${outputNewlineOptionsHtml(nl)}
            </select>
          </div>
        </div>`;
    }).join("");

    listEl.querySelectorAll<HTMLSelectElement>(".serial-port-baud").forEach(sel => {
      sel.addEventListener("change", async () => {
        await rememberSerialParams(sel.dataset.key!, { baud: parseInt(sel.value, 10) });
        showToast(`Baud saved: ${sel.value}`, "info", 1500);
        renderHistory();
      });
    });
    listEl.querySelectorAll<HTMLSelectElement>(".serial-port-mode").forEach(sel => {
      sel.addEventListener("change", async () => {
        await rememberSerialParams(sel.dataset.key!, { inputMode: sel.value as SerialInputMode });
        showToast(`Input mode saved: ${sel.value}`, "info", 1500);
        renderHistory();
      });
    });
    listEl.querySelectorAll<HTMLSelectElement>(".serial-port-nl").forEach(sel => {
      sel.addEventListener("change", async () => {
        await rememberSerialParams(sel.dataset.key!, { outputNewline: sel.value as SerialOutputNewline });
        showToast(`Output newlines saved: ${sel.value}`, "info", 1500);
        renderHistory();
      });
    });
  });
}

function renderSshPanel(container: HTMLElement) {
  const allHosts = sshHosts;
  // working copy: non-hidden hosts, shallow-cloned for edit safety
  const workingHosts: SshHost[] = allHosts.filter(h => !hiddenSshHosts.includes(h.name)).map(h => ({ ...h }));

  function render() {
    let hostRows = "";
    if (allHosts.length === 0) {
      hostRows = `<div class="settings-item">
        <div class="settings-item-desc">No SSH hosts found. Add hosts to your SSH config file to see them here.</div>
      </div>`;
    } else {
      hostRows = allHosts.map(h => {
        const visible = !hiddenSshHosts.includes(h.name);
        const hostname = hostProp(h, "hostname") || h.name;
        const user = hostProp(h, "user") || "root";
        const port = hostProp(h, "port") || "22";
        // extra info: all props except name, hostname, user, port
        const skipKeys = new Set(["name", "hostname", "user", "port"]);
        const extra = Object.entries(h).filter(([k]) => !skipKeys.has(k.toLowerCase())).map(([k, v]) => `${k}: ${v}`);
        return `<div class="ssh-host-card" style="margin-bottom:4px;background:#2a2a2a;border-radius:4px;overflow:hidden;">
          <div class="ssh-host-row" style="display:flex;align-items:flex-start;gap:8px;padding:8px 10px;cursor:pointer;">
            <div style="flex-shrink:0;padding-top:2px;" onclick="event.stopPropagation()">
              <label class="settings-toggle-row" style="padding:0;gap:0;">
                <input type="checkbox" class="ssh-vis-check" value="${esc(h.name)}" ${visible ? "checked" : ""} />
              </label>
            </div>
            <div style="min-width:0;flex:1;">
              <div class="settings-item-title" style="margin-bottom:2px;">${esc(h.name)}</div>
              <div class="settings-item-desc" style="margin-bottom:0;">${esc(user)}@${esc(hostname)}:${port}</div>
            </div>
            <div style="display:flex;gap:6px;flex-shrink:0;align-items:center;">
              <button class="ssh-btn-edit settings-link-btn" data-hostname="${esc(h.name)}" style="opacity:0.5;cursor:default;" onclick="event.stopPropagation()" disabled>Edit</button>
              <button class="ssh-btn-delete settings-link-btn" data-hostname="${esc(h.name)}" style="color:#f44747;border-color:#f44747;" onclick="event.stopPropagation()">Delete</button>
            </div>
          </div>
          <div class="ssh-host-detail" style="display:none;padding:0 10px 8px 10px;">
            ${extra.length > 0 ? `<div class="ssh-host-extra" style="font-size:12px;color:#888;margin-bottom:6px;word-break:break-all;padding-left:28px;">${extra.map(e => esc(e)).join(" <span style='color:#555'>·</span> ")}</div>` : ""}
            <div style="display:flex;gap:6px;padding-left:28px;">
              <button class="ssh-btn-clear settings-link-btn" data-hostname="${esc(hostname)}" style="background:#4a4a4a;">Clear KnownHosts</button>
              <button class="ssh-btn-copy-id settings-link-btn" data-hostname="${esc(hostname)}" data-port="${port}" data-user="${esc(user)}" style="background:#4a4a4a;opacity:0.6;cursor:default;" disabled>Upload SSH Key</button>
            </div>
          </div>
        </div>`;
      }).join("");
    }

    container.innerHTML = `
      <div class="settings-section">
        <div class="settings-section-title">SSH Configuration</div>
        <div class="settings-item settings-item-row">
          <div class="settings-item-info">
            <div class="settings-item-title">SSH Config File</div>
            <div class="settings-item-desc">Hosts are read from your OpenSSH config file. Check to show in new-tab menu. Changes to the host list are pending until saved.</div>
          </div>
          <div class="settings-item-control" style="display:flex;gap:8px;">
            <button id="set-open-ssh-config" class="settings-link-btn">Open File</button>
            <button id="set-reload-ssh" class="settings-link-btn">Reload</button>
          </div>
        </div>
      </div>
      <div class="settings-section">
        <div class="settings-section-title">Imported Hosts (${allHosts.length})</div>
        ${hostRows}
      </div>
      <div class="settings-section" style="display:flex;align-items:center;justify-content:space-between;">
        <div class="settings-item-desc" style="margin:0;">Saving will overwrite ~/.ssh/config. A backup is saved to config.tt.bak.</div>
        <button id="set-save-ssh-config" class="settings-btn">Save SSH Config</button>
      </div>
    `;

    wireSshEvents(container, workingHosts, render);
  }

  render();
}

function wireSshEvents(container: HTMLElement, workingHosts: SshHost[], rerender: () => void) {
  container.querySelector("#set-open-ssh-config")!.addEventListener("click", () => {
    invoke("open_ssh_config").catch(console.error);
  });

  container.querySelector("#set-reload-ssh")!.addEventListener("click", async () => {
    await loadSshHosts();
    renderSshPanel(container);
  });

  // Save: confirm, generate config, write via backend (footer feedback)
  container.querySelector("#set-save-ssh-config")!.addEventListener("click", async () => {
    const confirmed = confirm("This will overwrite your SSH config file (~/.ssh/config).\n\nA backup will be saved to config.tt.bak.\n\nContinue?");
    if (!confirmed) return;
    const deletedNames = new Set(sshHosts.filter(h => !hiddenSshHosts.includes(h.name) && !workingHosts.some(w => w.name === h.name)).map(h => h.name));
    const hostsToSave = sshHosts.filter(h => !deletedNames.has(h.name));
    const content = generateSshConfig(hostsToSave);
    try {
      const result = await invoke<string>("ssh_save_config", { content });
      await loadSshHosts();
      renderSshPanel(container);
      const fb = document.querySelector(".settings-feedback")!;
      const detail = result.trim();
      fb.innerHTML = `<div>${esc(detail.split("\n")[0] || detail)}</div>
        <div style="font-size:12px;color:#888;">${esc(detail)}</div>`;
      fb.className = "settings-feedback settings-feedback-ok";
      setTimeout(() => { fb.textContent = ""; }, 5000);
    } catch (err) {
      const fb = document.querySelector(".settings-feedback")!;
      fb.innerHTML = `<div>Failed to save SSH config</div>
        <div style="font-size:12px;color:#c44;">${esc(String(err))}</div>`;
      fb.className = "settings-feedback settings-feedback-info";
      setTimeout(() => { fb.textContent = ""; }, 5000);
    }
  });

  // Visibility checkboxes — persist immediately (like Profile panel)
  container.querySelectorAll<HTMLInputElement>(".ssh-vis-check").forEach(cb => {
    cb.addEventListener("change", async () => {
      const name = cb.value;
      if (cb.checked) {
        hiddenSshHosts.splice(hiddenSshHosts.indexOf(name), 1);
      } else if (!hiddenSshHosts.includes(name)) {
        hiddenSshHosts.push(name);
      }
      await saveConfig({ hiddenSshHosts });
    });
  });

  // Row click toggles expand/collapse
  container.querySelectorAll(".ssh-host-row").forEach(row => {
    row.addEventListener("click", () => {
      const card = row.closest(".ssh-host-card")!;
      const detail = card.querySelector(".ssh-host-detail") as HTMLElement;
      detail.style.display = detail.style.display === "block" ? "none" : "block";
    });
  });

  // Clear KnownHosts (footer feedback)
  container.querySelectorAll(".ssh-btn-clear").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const hostname = (btn as HTMLElement).dataset.hostname!;
      try {
        const result: string = await invoke("ssh_clear_known_hosts", { hostname });
        const detail = result.trim();
        const fb = document.querySelector(".settings-feedback")!;
        fb.innerHTML = `<div>Cleared known hosts for ${esc(hostname)}</div>
          <div style="font-size:12px;color:#888;">${esc(detail) || "No output"}</div>`;
        fb.className = "settings-feedback settings-feedback-ok";
        setTimeout(() => { fb.textContent = ""; }, 5000);
      } catch (err) {
        const fb = document.querySelector(".settings-feedback")!;
        fb.innerHTML = `<div>Failed to clear known hosts for ${esc(hostname)}</div>
          <div style="font-size:12px;color:#c44;">${esc(String(err))}</div>`;
        fb.className = "settings-feedback settings-feedback-info";
        setTimeout(() => { fb.textContent = ""; }, 5000);
      }
    });
  });

  // Upload SSH Key — placeholder (not yet implemented)

  // Delete: remove from working copy (not saved until Save SSH Config)
  container.querySelectorAll(".ssh-btn-delete").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const hostname = (btn as HTMLElement).dataset.hostname!;
      const idx = workingHosts.findIndex(h => h.name === hostname);
      if (idx !== -1) workingHosts.splice(idx, 1);
      rerender();
    });
  });
}

async function applySettings(root: HTMLElement) {
  const sizeEl = root.querySelector("#set-font-size") as HTMLInputElement;
  const profileEl = root.querySelector("#set-default-profile") as HTMLSelectElement;
  const pasteWarnEl = root.querySelector("#set-paste-warning") as HTMLInputElement;
  const bellEl = root.querySelector("#set-bell") as HTMLInputElement;
  const checks = root.querySelectorAll<HTMLInputElement>(".wt-profile-check");

  const partial: Record<string, unknown> = {};
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
  partial.themeName = root.dataset.themeName || configThemeName;
  const baudEl = root.querySelector("#set-serial-baud") as HTMLSelectElement;
  if (baudEl) partial.serialBaud = parseInt(baudEl.value, 10) || 115200;
  const modeEl = root.querySelector("#set-serial-input-mode") as HTMLSelectElement;
  if (modeEl) partial.serialInputMode = modeEl.value;
  const nlEl = root.querySelector("#set-serial-output-newline") as HTMLSelectElement;
  if (nlEl) partial.serialOutputNewline = nlEl.value;

  const hidden: string[] = [];
  checks.forEach(c => { if (!c.checked) hidden.push(c.value); });
  partial.hiddenProfiles = hidden;

  await saveConfig(partial);
  const cb = settingsChangedFn();
  if (cb) cb();
}

// Rebuild theme cards and wire click-to-choose. Called once after the footer
// (Apply button) exists.
function renderThemeGallery(root: HTMLElement, applyBtn: HTMLElement) {
  const gallery = root.querySelector("#set-theme-gallery") as HTMLElement;
  if (!gallery) return;
  root.dataset.themeName = root.dataset.themeName || configThemeName;
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
    // match the real terminal font, not generic monospace
    preview.style.fontFamily = configFontFamily;

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
      applyBtn.classList.remove("applied");
    });
    gallery.appendChild(card);
  }
  renderThemeGallerySelection(root);
}

function renderThemeGallerySelection(root: HTMLElement) {
  const current = root.dataset.themeName || configThemeName;
  root.querySelectorAll<HTMLElement>("#set-theme-gallery .theme-card").forEach(card => {
    card.classList.toggle("selected", card.dataset.theme === current);
  });
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}





// 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, Courier, monospace







