// Settings — SSH panel
// SSH config file management, host list, visibility, save/clear

import { invoke } from "@tauri-apps/api/core";
import Sortable from "sortablejs";
import { generateSshConfig, loadSshHosts } from "../config/ssh-config";
import { esc, hostProp } from "../core/common";
import { logError } from "../core/errorlog";
import { type ConfigState, configStore } from "../core/store";
import type { SshHost } from "../core/types";
import { confirmDialog } from "../ui/confirm";
import { showToast } from "../ui/toast";
import { showSshHostEditor } from "./sshhosteditor";
import { listKeys, showInstallKeyModal, showKeygenModal } from "./sshkeys";

export function createSshPanel(): HTMLElement {
  const panel = document.createElement("div");
  panel.className = "settings-panel-content";
  panel.dataset.panel = "ssh";
  panel.style.display = "none";
  renderSshPanel(panel);
  return panel;
}

export function refreshSshPanel(root: HTMLElement): void {
  // Re-render ONLY the SSH panel inside the settings page. Rendering into
  // `root` itself would wipe the sidebar, sibling panels, and the footer
  // (Revert did exactly that — the page "kept" only the SSH host list).
  const panel = root.querySelector<HTMLElement>('.settings-panel-content[data-panel="ssh"]');
  if (panel) renderSshPanel(panel);
}

function renderSshPanel(container: HTMLElement, opts?: { keepPending?: boolean }) {
  // Internal re-renders (Reload/Save/Delete/Add/Edit/keygen) rebuild the
  // whole panel from the store — keepPending preserves the not-yet-applied
  // Built-in-SSH-Client toggle across them. The Revert path (refreshSshPanel)
  // passes no flag and correctly resets it to the stored value.
  const pendingEmbedded = opts?.keepPending
    ? container.querySelector<HTMLInputElement>("#set-ssh-embedded")?.checked
    : undefined;
  const allHosts = configStore.get("sshHosts");
  const hiddenSshHosts = configStore.get("hiddenSshHosts");

  let hostRows = "";
  if (allHosts.length === 0) {
    hostRows = `<div class="settings-item">
      <div class="settings-item-desc">No SSH hosts found. Add hosts to your SSH config file to see them here.</div>
    </div>`;
  } else {
    hostRows = allHosts
      .map((h) => {
        const visible = !hiddenSshHosts.includes(h.name);
        const hostname = hostProp(h, "hostname") || h.name;
        const user = hostProp(h, "user") || "root";
        const port = hostProp(h, "port") || "22";
        const skipKeys = new Set(["name", "hostname", "user", "port"]);
        const extra = Object.entries(h)
          .filter(([k]) => !skipKeys.has(k.toLowerCase()))
          // Multi-line values (merged forward directives) read as a list.
          .flatMap(([k, v]) => v.split("\n").map((line) => `${k}: ${line}`));
        return `<div class="ssh-host-card" data-name="${esc(h.name)}" style="margin-bottom:4px;background:#2a2a2a;border-radius:4px;overflow:hidden;">
        <div class="ssh-host-row" style="display:flex;align-items:flex-start;gap:8px;padding:8px 10px;cursor:pointer;">
          <div style="flex-shrink:0;padding-top:2px;">
            <label class="settings-toggle-row" style="padding:0;gap:0;">
              <input type="checkbox" class="ssh-vis-check" value="${esc(h.name)}" ${visible ? "checked" : ""} />
            </label>
          </div>
          <div style="min-width:0;flex:1;">
            <div class="settings-item-title" style="margin-bottom:2px;">${esc(h.name)}</div>
            <div class="settings-item-desc" style="margin-bottom:0;">${esc(user)}@${esc(hostname)}:${esc(port)}</div>
          </div>
          <div style="display:flex;gap:6px;flex-shrink:0;align-items:center;">
            <button class="ssh-btn-edit settings-link-btn" data-hostname="${esc(h.name)}">Edit</button>
            <button class="ssh-btn-delete settings-link-btn" data-hostname="${esc(h.name)}" style="color:#f44747;border-color:#f44747;">Delete</button>
          </div>
        </div>
        <div class="ssh-host-detail" style="display:none;padding:0 10px 8px 10px;">
          ${extra.length > 0 ? `<div class="ssh-host-extra" style="font-size:12px;color:#888;margin-bottom:6px;padding-left:28px;display:flex;flex-direction:column;gap:2px;">${extra.map((e) => `<div style="word-break:break-all;">${esc(e)}</div>`).join("")}</div>` : ""}
          <div style="display:flex;gap:6px;padding-left:28px;">
            <button class="ssh-btn-clear settings-link-btn" data-hostname="${esc(hostname)}" style="background:#4a4a4a;">Clear KnownHosts</button>
            <button class="ssh-btn-copy-id settings-link-btn" data-hostname="${esc(hostname)}" data-port="${esc(port)}" data-user="${esc(user)}" style="background:#4a4a4a;">Upload SSH Key</button>
          </div>
        </div>
      </div>`;
      })
      .join("");
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
            <input type="checkbox" id="set-ssh-embedded" ${(pendingEmbedded ?? configStore.get("sshEmbedded")) ? "checked" : ""} />
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
      <div class="ssh-host-list">${hostRows}</div>
    </div>
    <div class="settings-section">
      <div class="settings-section-title" style="display:flex;align-items:center;justify-content:space-between;">
        <span>SSH Keys</span>
        <button id="set-gen-ssh-key" class="settings-link-btn">+ Generate Key</button>
      </div>
      <div class="settings-item-desc" style="margin-bottom:6px;">Key pairs in ~/.ssh. Upload a public key from a host's detail view above — the private key never leaves this machine.</div>
      <div class="ssh-key-list"></div>
    </div>
    <div class="settings-section" style="display:flex;align-items:center;justify-content:space-between;">
      <div class="settings-item-desc" style="margin:0;">Saving will overwrite ~/.ssh/config. A backup is saved to config.tt.bak.</div>
      <button id="set-save-ssh-config" class="settings-btn">Save SSH Config</button>
    </div>
  `;

  wireSshEvents(container);

  // Key list loads async — the panel re-renders often, so refill every time.
  const keyList = container.querySelector<HTMLElement>(".ssh-key-list")!;
  listKeys().then((keys) => {
    if (!keyList.isConnected) return; // panel re-rendered meanwhile
    keyList.innerHTML =
      keys.length === 0
        ? `<div class="settings-item"><div class="settings-item-desc">No key pairs found. Generate one to enable passwordless logins.</div></div>`
        : keys
            .map(
              (k) => `<div class="settings-item settings-item-row">
          <div class="settings-item-info">
            <div class="settings-item-title">${esc(k.name)}</div>
            <div class="settings-item-desc">${esc(k.fingerprint)}</div>
          </div>
          <div class="settings-item-control">
            <button class="settings-link-btn ssh-key-copy" data-key="${esc(k.publicKey)}">Copy Public Key</button>
          </div>
        </div>`,
            )
            .join("");
    keyList.querySelectorAll<HTMLButtonElement>(".ssh-key-copy").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await navigator.clipboard.writeText(btn.dataset.key!);
        showToast("Public key copied to clipboard", "info");
      });
    });
  });
}

// The host-list Sortable, tracked so a panel re-render can destroy the
// instance bound to the discarded DOM.
let hostListSortable: Sortable | null = null;

// Dirty = the sshHosts working copy differs from what's on disk.
// Add/Edit/Delete/drag set it; a successful Save or a Reload clears it.
// The settings shell shows a persistent hint in the footer (Revert/Apply
// bar); changes are pushed to it via a bubbling CustomEvent so the user
// sees the state in real time, on any panel.
let sshConfigDirty = false;

export function isSshConfigDirty(): boolean {
  return sshConfigDirty;
}

/// Test seam: the dirty flag is module state shared across panel renders.
export function resetSshConfigDirty(): void {
  sshConfigDirty = false;
}

function setSshConfigDirty(dirty: boolean, from: HTMLElement): void {
  if (sshConfigDirty === dirty) return;
  sshConfigDirty = dirty;
  from.dispatchEvent(new CustomEvent("tterm-ssh-dirty", { detail: dirty, bubbles: true }));
}

/// Reorder the sshHosts working copy to match the card order in the DOM
/// after a drag. Pending until Save SSH Config, like Add/Edit/Delete.
export function syncSshHostOrder(list: HTMLElement): void {
  const order = [...list.querySelectorAll<HTMLElement>(".ssh-host-card")].map(
    (c) => c.dataset.name ?? "",
  );
  const hosts = configStore.get("sshHosts");
  const byName = new Map(hosts.map((h) => [h.name, h]));
  const reordered = order.map((n) => byName.get(n)).filter((h): h is SshHost => !!h);
  // Paranoia: if the DOM and the store disagree on membership, keep the
  // store's order rather than silently dropping hosts.
  if (reordered.length !== hosts.length) return;
  configStore.set({ sshHosts: reordered });
  setSshConfigDirty(true, list);
}

function wireSshEvents(container: HTMLElement) {
  // The footer's feedback span, looked up via the settings page root.
  // Null-safe: closing the Settings tab mid-invoke must not throw.
  const showFeedback = (title: string, detail: string, ok: boolean) => {
    const fb = container
      .closest(".settings-page")
      ?.querySelector<HTMLElement>(".settings-feedback");
    if (!fb?.isConnected) return;
    fb.innerHTML = `<div>${esc(title)}</div>
      <div style="font-size:12px;color:${ok ? "#888" : "#c44"};">${esc(detail)}</div>`;
    fb.className = `settings-feedback ${ok ? "settings-feedback-ok" : "settings-feedback-info"}`;
    setTimeout(() => {
      fb.textContent = "";
    }, 5000);
  };

  container.querySelector("#set-open-ssh-config")?.addEventListener("click", () => {
    invoke("open_ssh_config").catch(logError.bind(null, "ssh.openConfig"));
  });

  container.querySelector("#set-reload-ssh")?.addEventListener("click", async () => {
    const hosts = await loadSshHosts();
    configStore.set({ sshHosts: hosts });
    setSshConfigDirty(false, container); // working copy matches the file
    renderSshPanel(container, { keepPending: true });
  });

  container.querySelector("#set-save-ssh-config")?.addEventListener("click", async () => {
    const confirmed = await confirmDialog({
      title: "Overwrite SSH config?",
      message: "This will overwrite ~/.ssh/config. A backup will be saved to config.tt.bak.",
      okLabel: "Overwrite",
      danger: true,
    });
    if (!confirmed) return;
    const allHosts = configStore.get("sshHosts");
    const content = generateSshConfig(allHosts);
    try {
      const result = await invoke<string>("ssh_save_config", { content });
      const hosts = await loadSshHosts();
      configStore.set({ sshHosts: hosts });
      setSshConfigDirty(false, container); // written to disk
      renderSshPanel(container, { keepPending: true });
      const detail = result.trim();
      showFeedback(detail.split("\n")[0] || detail, detail, true);
    } catch (err) {
      showFeedback("Failed to save SSH config", String(err), false);
    }
  });

  // Visibility checkboxes — persist immediately
  container.querySelectorAll<HTMLInputElement>(".ssh-vis-check").forEach((cb) => {
    // Inline onclick is CSP-blocked: stop row-expand bubbling in JS instead.
    cb.addEventListener("click", (e) => {
      e.stopPropagation();
    });
    cb.addEventListener("change", async () => {
      const name = cb.value;
      let hidden = [...configStore.get("hiddenSshHosts")];
      if (cb.checked) {
        hidden = hidden.filter((n) => n !== name);
      } else if (!hidden.includes(name)) {
        hidden.push(name);
      }
      configStore.set({ hiddenSshHosts: hidden });
    });
  });

  // Row click toggles expand/collapse. Expanded cards show their full
  // config one property per line — and are excluded from drag reorder.
  container.querySelectorAll(".ssh-host-row").forEach((row) => {
    row.addEventListener("click", () => {
      const card = row.closest(".ssh-host-card")!;
      const detail = card.querySelector(".ssh-host-detail") as HTMLElement;
      const show = detail.style.display !== "block";
      detail.style.display = show ? "block" : "none";
      card.classList.toggle("expanded", show);
    });
  });

  // Drag reorder of host cards. The new order lands in the working copy
  // (pending until Save SSH Config), exactly like Add/Edit/Delete.
  // Expanded cards are excluded from dragging per interaction design.
  const list = container.querySelector<HTMLElement>(".ssh-host-list");
  if (list) {
    hostListSortable?.destroy(); // previous instance bound to dead DOM
    hostListSortable = new Sortable(list, {
      animation: 150,
      direction: "vertical",
      draggable: ".ssh-host-card:not(.expanded)",
      filter: "button, input",
      preventOnFilter: false,
      forceFallback: true,
      fallbackTolerance: 5,
      onEnd: () => syncSshHostOrder(list),
    });
  }

  // Clear KnownHosts
  container.querySelectorAll(".ssh-btn-clear").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const hostname = (btn as HTMLElement).dataset.hostname!;
      try {
        const result: string = await invoke("ssh_clear_known_hosts", { hostname });
        const detail = result.trim();
        showFeedback(`Cleared known hosts for ${hostname}`, detail || "No output", true);
      } catch (err) {
        showFeedback(`Failed to clear known hosts for ${hostname}`, String(err), false);
      }
    });
  });

  // Upload SSH Key: pick a local public key and install it on this host.
  container.querySelectorAll<HTMLButtonElement>(".ssh-btn-copy-id").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      showInstallKeyModal({
        hostname: btn.dataset.hostname!,
        port: parseInt(btn.dataset.port!, 10) || 22,
        user: btn.dataset.user!,
      });
    });
  });

  // Generate Key: new pair lands in ~/.ssh; the list refreshes on the next
  // panel render, so trigger one after generation.
  container.querySelector<HTMLButtonElement>("#set-gen-ssh-key")?.addEventListener("click", () => {
    showKeygenModal({ onSaved: () => renderSshPanel(container, { keepPending: true }) });
  });

  // Delete: remove from working copy (not saved until Save SSH Config)
  container.querySelectorAll(".ssh-btn-delete").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const hostname = (btn as HTMLElement).dataset.hostname!;
      const hosts = configStore.get("sshHosts").filter((h) => h.name !== hostname);
      configStore.set({ sshHosts: hosts });
      setSshConfigDirty(true, container);
      renderSshPanel(container, { keepPending: true });
    });
  });

  // Add Host / Edit: both open the shared host editor modal. The result
  // lands in the working copy (pending until Save SSH Config).
  const saveHost = (container2: HTMLElement) => (host: SshHost, originalName?: string) => {
    const hosts = configStore.get("sshHosts");
    const next = originalName
      ? hosts.map((h) => (h.name === originalName ? host : h))
      : [...hosts, host];
    configStore.set({ sshHosts: next });
    setSshConfigDirty(true, container2);
    renderSshPanel(container2, { keepPending: true });
  };

  container.querySelector<HTMLButtonElement>("#set-add-ssh-host")?.addEventListener("click", () => {
    showSshHostEditor({ onSaved: saveHost(container) });
  });

  container.querySelectorAll<HTMLButtonElement>(".ssh-btn-edit").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const name = btn.dataset.hostname!;
      const base = configStore.get("sshHosts").find((h) => h.name === name);
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
