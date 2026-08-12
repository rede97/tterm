// Settings — SSH panel (lit-html pilot)
// SSH config file management, host list, visibility, save/clear.
//
// Pilot for the lit-html migration (docs/frontend-governance.md P3): the
// panel renders through lit-html's diffing render() from store + per-panel
// state, so re-renders after Add/Edit/Delete/Reload/Save patch DOM instead
// of rebuilding it — card expansion, the pending Built-in toggle, and the
// Sortable instance all survive. The keepPending hack is gone: the toggle
// is bound to panel state, not rescued from doomed DOM.

import { invoke } from "@tauri-apps/api/core";
import Sortable from "sortablejs";
import { generateSshConfig, loadSshHosts } from "../config/ssh-config";
import { hostProp } from "../core/common";
import { logCatch, logError } from "../core/errorlog";
import { type ConfigState, configStore } from "../core/store";
import type { SshHost } from "../core/types";
import { confirmDialog } from "../ui/confirm";
import { html as domHtml, setHtml } from "../ui/dom";
import { html, infoRow, itemRow, linkBtn, render, repeat, section, toggle } from "../ui/lit";
import { showToast } from "../ui/toast";
import { showSshHostEditor } from "./sshhosteditor";
import { listKeys, type SshKeyInfo, showInstallKeyModal, showKeygenModal } from "./sshkeys";

// ---- Per-panel state -------------------------------------------------
// Pending/view state only — the host working copy stays in configStore
// (single source of truth). Per panel element so a second Settings page
// never inherits another's expansion or pending toggle.

interface SshPanelState {
  // Pending Built-in-SSH-Client toggle (applied by the shell's Apply;
  // reset from the store on Revert). Replaces the keepPending DOM rescue.
  embedded: boolean;
  // Expanded host cards, by host name — survives re-renders.
  expanded: Set<string>;
  // ~/.ssh key pairs; null = still loading.
  keys: SshKeyInfo[] | null;
}

const panelStates = new WeakMap<HTMLElement, SshPanelState>();

function stateOf(panel: HTMLElement): SshPanelState {
  let st = panelStates.get(panel);
  if (!st) {
    st = { embedded: configStore.get("sshEmbedded"), expanded: new Set(), keys: null };
    panelStates.set(panel, st);
  }
  return st;
}

export function createSshPanel(): HTMLElement {
  const panel = document.createElement("div");
  panel.className = "settings-panel-content";
  panel.dataset.panel = "ssh";
  panel.style.display = "none";
  renderSshPanel(panel);
  loadKeys(panel);
  // Sortable binds ONCE — lit-html's keyed repeat keeps the list element
  // (and card nodes, across reorders) alive, so there is no dead-DOM
  // destroy/recreate cycle like the innerHTML era.
  const list = panel.querySelector<HTMLElement>(".ssh-host-list");
  if (list) {
    new Sortable(list, {
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
  return panel;
}

export function refreshSshPanel(root: HTMLElement): void {
  // Re-render ONLY the SSH panel inside the settings page. Rendering into
  // `root` itself would wipe the sidebar, sibling panels, and the footer
  // (Revert did exactly that — the page "kept" only the SSH host list).
  const panel = root.querySelector<HTMLElement>('.settings-panel-content[data-panel="ssh"]');
  if (!panel) return;
  const st = stateOf(panel);
  st.embedded = configStore.get("sshEmbedded"); // Revert drops the pending toggle
  st.keys = null;
  renderSshPanel(panel);
  loadKeys(panel);
}

// ---- Dirty tracking (unchanged contract with the settings shell) -----

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

// ---- Rendering ---------------------------------------------------------

function renderSshPanel(panel: HTMLElement): void {
  render(sshTemplate(panel), panel);
}

function loadKeys(panel: HTMLElement): void {
  const st = stateOf(panel);
  listKeys().then((keys) => {
    if (!panel.isConnected) return; // settings tab closed meanwhile
    st.keys = keys;
    renderSshPanel(panel);
  });
}

function sshTemplate(panel: HTMLElement) {
  const st = stateOf(panel);
  const hosts = configStore.get("sshHosts");
  const hidden = configStore.get("hiddenSshHosts");

  return html`
    ${section(
      "SSH Configuration",
      html`
        ${itemRow(
          "Built-in SSH Client",
          "Use TTerm's integrated SSH client — password dialogs, host-key confirmation, and dynamic port forwarding (tab right-click menu). Off: spawn the system ssh command instead.",
          toggle(
            st.embedded,
            (v) => {
              st.embedded = v;
            },
            { id: "set-ssh-embedded" },
          ),
        )}
        ${itemRow(
          "SSH Config File",
          "Hosts are read from your OpenSSH config file. Check to show in new-tab menu. Changes to the host list are pending until saved.",
          html`<div class="ssh-host-actions">
            ${linkBtn(
              "Open File",
              () => {
                invoke("open_ssh_config").catch(logError.bind(null, "ssh.openConfig"));
              },
              { id: "set-open-ssh-config" },
            )}
            ${linkBtn(
              "Reload",
              async () => {
                const reloaded = await loadSshHosts();
                configStore.set({ sshHosts: reloaded });
                setSshConfigDirty(false, panel); // working copy matches the file
                renderSshPanel(panel);
              },
              { id: "set-reload-ssh" },
            )}
          </div>`,
        )}
      `,
    )}
    ${section(
      `Imported Hosts (${hosts.length})`,
      html`<div class="ssh-host-list">
        ${
          hosts.length === 0
            ? infoRow("No SSH hosts found. Add hosts to your SSH config file to see them here.")
            : repeat(
                hosts,
                (h) => h.name,
                (h) => hostCard(panel, st, h, hidden),
              )
        }
      </div>`,
      linkBtn("+ Add Host", () => showSshHostEditor({ onSaved: saveHost(panel) }), {
        id: "set-add-ssh-host",
      }),
    )}
    ${section(
      "SSH Keys",
      html`
        <div class="settings-item-desc ssh-keys-hint">Key pairs in ~/.ssh. Upload a public key from a host's detail view above — the private key never leaves this machine.</div>
        <div class="ssh-key-list">${keyList(st)}</div>
      `,
      linkBtn("+ Generate Key", () => showKeygenModal({ onSaved: () => loadKeys(panel) }), {
        id: "set-gen-ssh-key",
      }),
    )}
    <div class="settings-section ssh-save-row">
      <div class="settings-item-desc ssh-save-hint">Saving will overwrite ~/.ssh/config. A backup is saved to config.tt.bak.</div>
      <button id="set-save-ssh-config" class="settings-btn" @click=${() => saveConfig(panel)}>
        Save SSH Config
      </button>
    </div>
  `;
}

function hostCard(panel: HTMLElement, st: SshPanelState, h: SshHost, hidden: string[]) {
  const visible = !hidden.includes(h.name);
  const hostname = hostProp(h, "hostname") || h.name;
  const user = hostProp(h, "user") || "root";
  const port = hostProp(h, "port") || "22";
  const expanded = st.expanded.has(h.name);
  const skipKeys = new Set(["name", "hostname", "user", "port"]);
  const extra = Object.entries(h)
    .filter(([k]) => !skipKeys.has(k.toLowerCase()))
    // Multi-line values (merged forward directives) read as a list.
    .flatMap(([k, v]) => v.split("\n").map((line) => `${k}: ${line}`));

  return html`<div class="ssh-host-card ${expanded ? "expanded" : ""}" data-name=${h.name}>
    <div
      class="ssh-host-row"
      @click=${() => {
        if (expanded) st.expanded.delete(h.name);
        else st.expanded.add(h.name);
        renderSshPanel(panel);
      }}
    >
      <div class="ssh-host-check">
        ${toggle(
          visible,
          (v) => {
            let next = [...configStore.get("hiddenSshHosts")];
            if (v) next = next.filter((n) => n !== h.name);
            else if (!next.includes(h.name)) next.push(h.name);
            configStore.set({ hiddenSshHosts: next });
          },
          { value: h.name },
        )}
      </div>
      <div class="ssh-host-main">
        <div class="settings-item-title ssh-host-name">${h.name}</div>
        <div class="settings-item-desc ssh-host-target">${user}@${hostname}:${port}</div>
      </div>
      <div class="ssh-host-actions">
        ${linkBtn(
          "Edit",
          (e) => {
            e.stopPropagation();
            showSshHostEditor({ base: h, onSaved: saveHost(panel) });
          },
          { cls: "ssh-btn-edit" },
        )}
        ${linkBtn(
          "Delete",
          (e) => {
            e.stopPropagation();
            configStore.set({
              sshHosts: configStore.get("sshHosts").filter((x) => x.name !== h.name),
            });
            setSshConfigDirty(true, panel);
            renderSshPanel(panel);
          },
          { danger: true, cls: "ssh-btn-delete" },
        )}
      </div>
    </div>
    <div class="ssh-host-detail">
      ${
        extra.length > 0
          ? html`<div class="ssh-host-extra">
            ${extra.map((line) => html`<div class="ssh-host-extra-line">${line}</div>`)}
          </div>`
          : ""
      }
      <div class="ssh-host-detail-actions">
        ${linkBtn(
          "Clear KnownHosts",
          async (e) => {
            e.stopPropagation();
            try {
              const result: string = await invoke("ssh_clear_known_hosts", { hostname });
              const detail = result.trim();
              showFeedback(
                panel,
                `Cleared known hosts for ${hostname}`,
                detail || "No output",
                true,
              );
            } catch (err) {
              showFeedback(
                panel,
                `Failed to clear known hosts for ${hostname}`,
                String(err),
                false,
              );
            }
          },
          { cls: "ssh-card-btn ssh-btn-clear" },
        )}
        ${linkBtn(
          "Upload SSH Key",
          (e) => {
            e.stopPropagation();
            showInstallKeyModal({ hostname, port: parseInt(port, 10) || 22, user });
          },
          { cls: "ssh-card-btn ssh-btn-copy-id" },
        )}
      </div>
    </div>
  </div>`;
}

function keyList(st: SshPanelState) {
  if (st.keys === null) return ""; // loading — fills async
  if (st.keys.length === 0) {
    return infoRow("No key pairs found. Generate one to enable passwordless logins.");
  }
  return st.keys.map(
    (k) => html`<div class="settings-item settings-item-row">
      <div class="settings-item-info">
        <div class="settings-item-title">${k.name}</div>
        <div class="settings-item-desc">${k.fingerprint}</div>
      </div>
      <div class="settings-item-control">
        ${linkBtn(
          "Copy Public Key",
          async () => {
            await navigator.clipboard
              .writeText(k.publicKey)
              .then(() => showToast("Public key copied to clipboard", "info"))
              .catch(logCatch("clipboard.write"));
          },
          { cls: "ssh-key-copy" },
        )}
      </div>
    </div>`,
  );
}

// ---- Actions -----------------------------------------------------------

/// Add/Edit result lands in the working copy (pending until Save SSH Config).
function saveHost(panel: HTMLElement) {
  return (host: SshHost, originalName?: string) => {
    const hosts = configStore.get("sshHosts");
    const next = originalName
      ? hosts.map((h) => (h.name === originalName ? host : h))
      : [...hosts, host];
    configStore.set({ sshHosts: next });
    setSshConfigDirty(true, panel);
    renderSshPanel(panel);
  };
}

async function saveConfig(panel: HTMLElement): Promise<void> {
  const confirmed = await confirmDialog({
    title: "Overwrite SSH config?",
    message: "This will overwrite ~/.ssh/config. A backup will be saved to config.tt.bak.",
    okLabel: "Overwrite",
    danger: true,
  });
  if (!confirmed) return;
  const content = generateSshConfig(configStore.get("sshHosts"));
  try {
    const result = await invoke<string>("ssh_save_config", { content });
    const hosts = await loadSshHosts();
    configStore.set({ sshHosts: hosts });
    setSshConfigDirty(false, panel); // written to disk
    renderSshPanel(panel);
    const detail = result.trim();
    showFeedback(panel, detail.split("\n")[0] || detail, detail, true);
  } catch (err) {
    showFeedback(panel, "Failed to save SSH config", String(err), false);
  }
}

/// The footer's feedback span, looked up via the settings page root.
/// Null-safe: closing the Settings tab mid-invoke must not throw.
function showFeedback(panel: HTMLElement, title: string, detail: string, ok: boolean): void {
  const fb = panel.closest(".settings-page")?.querySelector<HTMLElement>(".settings-feedback");
  if (!fb?.isConnected) return;
  setHtml(
    fb,
    domHtml`<div>${title}</div>
    <div style="font-size:12px;color:${ok ? "#888" : "#c44"};">${detail}</div>`,
  );
  fb.className = `settings-feedback ${ok ? "settings-feedback-ok" : "settings-feedback-info"}`;
  setTimeout(() => {
    fb.textContent = "";
  }, 5000);
}

export function collectSshSettings(root: HTMLElement): Partial<ConfigState> {
  const partial: Partial<ConfigState> = {};
  const embeddedEl = root.querySelector<HTMLInputElement>("#set-ssh-embedded");
  if (embeddedEl) partial.sshEmbedded = embeddedEl.checked;
  return partial;
}
