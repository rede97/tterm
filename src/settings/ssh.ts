// Settings — SSH panel
// SSH config file management, host list, visibility, save/clear

import { invoke } from "@tauri-apps/api/core";
import { configStore, type ConfigState } from "../core/store";
import { hostProp, esc} from "../core/common";
import { loadSshHosts, generateSshConfig } from "../config/ssh-config";
import { logError } from "../core/errorlog";
import { showSshHostEditor } from "./sshhosteditor";
import type { SshHost } from "../core/types";

export function createSshPanel(): HTMLElement {
  const panel = document.createElement("div");
  panel.className = "settings-panel-content";
  panel.dataset.panel = "ssh";
  panel.style.display = "none";
  renderSshPanel(panel);
  return panel;
}

export function refreshSshPanel(root: HTMLElement): void {
  renderSshPanel(root);
}

function renderSshPanel(container: HTMLElement) {
  const allHosts = configStore.get("sshHosts");
  const hiddenSshHosts = configStore.get("hiddenSshHosts");

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
      const skipKeys = new Set(["name", "hostname", "user", "port"]);
      const extra = Object.entries(h)
        .filter(([k]) => !skipKeys.has(k.toLowerCase()))
        // Multi-line values (merged forward directives) read as a list.
        .flatMap(([k, v]) => v.split("\n").map(line => `${k}: ${line}`));
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
            <button class="ssh-btn-edit settings-link-btn" data-hostname="${esc(h.name)}" onclick="event.stopPropagation()">Edit</button>
            <button class="ssh-btn-delete settings-link-btn" data-hostname="${esc(h.name)}" style="color:#f44747;border-color:#f44747;" onclick="event.stopPropagation()">Delete</button>
          </div>
        </div>
        <div class="ssh-host-detail" style="display:none;padding:0 10px 8px 10px;">
          ${extra.length > 0 ? `<div class="ssh-host-extra" style="font-size:12px;color:#888;margin-bottom:6px;word-break:break-all;padding-left:28px;">${extra.map(e => esc(e)).join(" <span style='color:#555'>\u00b7</span> ")}</div>` : ""}
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
          <div class="settings-item-title">Built-in SSH Client</div>
          <div class="settings-item-desc">Use TTerm's integrated SSH client — password dialogs, host-key confirmation, and dynamic port forwarding (tab right-click menu). Off: spawn the system ssh command instead.</div>
        </div>
        <div class="settings-item-control">
          <label class="settings-toggle-row" style="padding:0;gap:0;">
            <input type="checkbox" id="set-ssh-embedded" ${configStore.get("sshEmbedded") ? "checked" : ""} />
          </label>
        </div>
      </div>
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
      <div class="settings-section-title" style="display:flex;align-items:center;justify-content:space-between;">
        <span>Imported Hosts (${allHosts.length})</span>
        <button id="set-add-ssh-host" class="settings-link-btn">+ Add Host</button>
      </div>
      ${hostRows}
    </div>
    <div class="settings-section" style="display:flex;align-items:center;justify-content:space-between;">
      <div class="settings-item-desc" style="margin:0;">Saving will overwrite ~/.ssh/config. A backup is saved to config.tt.bak.</div>
      <button id="set-save-ssh-config" class="settings-btn">Save SSH Config</button>
    </div>
  `;

  wireSshEvents(container);
}

function wireSshEvents(container: HTMLElement) {
  container.querySelector("#set-open-ssh-config")!.addEventListener("click", () => {
    invoke("open_ssh_config").catch(logError.bind(null, "ssh.openConfig"));
  });

  container.querySelector("#set-reload-ssh")!.addEventListener("click", async () => {
    const hosts = await loadSshHosts();
    configStore.set({ sshHosts: hosts });
    renderSshPanel(container);
  });

  container.querySelector("#set-save-ssh-config")!.addEventListener("click", async () => {
    const confirmed = confirm("This will overwrite your SSH config file (~/.ssh/config).\n\nA backup will be saved to config.tt.bak.\n\nContinue?");
    if (!confirmed) return;
    const allHosts = configStore.get("sshHosts");
    const content = generateSshConfig(allHosts);
    try {
      const result = await invoke<string>("ssh_save_config", { content });
      const hosts = await loadSshHosts();
      configStore.set({ sshHosts: hosts });
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

  // Visibility checkboxes — persist immediately
  container.querySelectorAll<HTMLInputElement>(".ssh-vis-check").forEach(cb => {
    cb.addEventListener("change", async () => {
      const name = cb.value;
      let hidden = [...configStore.get("hiddenSshHosts")];
      if (cb.checked) {
        hidden = hidden.filter(n => n !== name);
      } else if (!hidden.includes(name)) {
        hidden.push(name);
      }
      configStore.set({ hiddenSshHosts: hidden });
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

  // Clear KnownHosts
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

  // Delete: remove from working copy (not saved until Save SSH Config)
  container.querySelectorAll(".ssh-btn-delete").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const hostname = (btn as HTMLElement).dataset.hostname!;
      const hosts = configStore.get("sshHosts").filter(h => h.name !== hostname);
      configStore.set({ sshHosts: hosts });
      renderSshPanel(container);
    });
  });

  // Add Host / Edit: both open the shared host editor modal. The result
  // lands in the working copy (pending until Save SSH Config).
  const saveHost = (container2: HTMLElement) =>
    (host: SshHost, originalName?: string) => {
      const hosts = configStore.get("sshHosts");
      const next = originalName
        ? hosts.map(h => (h.name === originalName ? host : h))
        : [...hosts, host];
      configStore.set({ sshHosts: next });
      renderSshPanel(container2);
    };

  container.querySelector<HTMLButtonElement>("#set-add-ssh-host")!
    .addEventListener("click", () => {
      showSshHostEditor({ onSaved: saveHost(container) });
    });

  container.querySelectorAll<HTMLButtonElement>(".ssh-btn-edit").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const name = btn.dataset.hostname!;
      const base = configStore.get("sshHosts").find(h => h.name === name);
      if (base) showSshHostEditor({ base, onSaved: saveHost(container) });
    });
  });
}

// The host editor modal (sshhosteditor.ts) serves both Add and Edit; the
// result lands in the working copy (pending until Save SSH Config),
// exactly like Delete.

export function collectSshSettings(root: HTMLElement): Partial<ConfigState> {
  const partial: Partial<ConfigState> = {};
  const embeddedEl = root.querySelector<HTMLInputElement>("#set-ssh-embedded");
  if (embeddedEl) partial.sshEmbedded = embeddedEl.checked;
  return partial;
}

