// Settings — SSH panel (lit-html pilot)
// SSH config file management, host list, visibility, save/clear.
//
// lit-html panel (pilot): the panel renders through lit-html's diffing
// render() from store + per-panel
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
import { html, infoRow, itemRow, linkBtn, render, repeat, section, toggle } from "../ui/lit";
import { showToast } from "../ui/toast";
import { showSshHostEditor } from "./sshhosteditor";
import { listKeys, type SshKeyInfo, showInstallKeyModal, showKeygenModal } from "./sshkeys";

// Host ⋯ menus: one module-level dismissal (outside click / Escape).
document.addEventListener("click", (e) => {
  if (!(e.target instanceof Element) || !e.target.closest(".host-more")) {
    for (const m of document.querySelectorAll(".host-more-menu.open")) {
      m.classList.remove("open");
    }
  }
});
window.addEventListener(
  "keydown",
  (e) => {
    if (e.key !== "Escape") return;
    for (const m of document.querySelectorAll(".host-more-menu.open")) {
      m.classList.remove("open");
    }
  },
  true,
);

// ---- Per-panel state -------------------------------------------------
// Pending/view state only — the host working copy stays in configStore
// (single source of truth). Per panel element so a second Settings page
// never inherits another's expansion or pending toggle.

interface SshPanelState {
  // Pending Built-in-SSH-Client toggle (applied by the shell's Apply;
  // reset from the store on Revert). Replaces the keepPending DOM rescue.
  embedded: boolean;
  // ~/.ssh key pairs; null = still loading.
  keys: SshKeyInfo[] | null;
}

const panelStates = new WeakMap<HTMLElement, SshPanelState>();

function stateOf(panel: HTMLElement): SshPanelState {
  let st = panelStates.get(panel);
  if (!st) {
    st = { embedded: configStore.get("sshEmbedded"), keys: null };
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
      draggable: ".check-row",
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

/// Reorder the sshHosts working copy to match the row order in the DOM
/// after a drag. Pending until the shell's Apply, like Add/Edit/Delete.
export function syncSshHostOrder(list: HTMLElement): void {
  const order = [...list.querySelectorAll<HTMLElement>(".check-row")].map(
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
      "Client",
      itemRow(
        "Built-in SSH client",
        "Use embedded russh instead of system ssh (password prompts, host-key confirm, port forwards).",
        toggle(
          st.embedded,
          (v) => {
            st.embedded = v;
          },
          { id: "set-ssh-embedded" },
        ),
      ),
    )}
    ${section(
      "Hosts from ~/.ssh/config",
      html`
        <p class="section-note">
          Edits join the same Apply as app settings. No separate Save — writing
          config is silent (a config.tt.bak backup is kept).
        </p>
        <div class="host-toolbar">
          <button
            type="button"
            class="tt-btn tt-btn-primary"
            id="set-add-ssh-host"
            @click=${() => showSshHostEditor({ onSaved: saveHost(panel) })}
          >+ Add Host</button>
          <button
            type="button"
            class="tt-btn tt-btn-ghost"
            id="set-reload-ssh"
            @click=${async () => {
              const reloaded = await loadSshHosts();
              configStore.set({ sshHosts: reloaded });
              setSshConfigDirty(false, panel); // working copy matches the file
              renderSshPanel(panel);
            }}
          >Reload from disk</button>
          <button
            type="button"
            class="tt-btn tt-btn-ghost"
            id="set-open-ssh-config"
            @click=${() => invoke("open_ssh_config").catch(logError.bind(null, "ssh.openConfig"))}
          >Open File</button>
        </div>
        <div class="ssh-host-list host-list">
          ${
            hosts.length === 0
              ? infoRow("No SSH hosts found. Add hosts to your SSH config file to see them here.")
              : repeat(
                  hosts,
                  (h) => h.name,
                  (h) => hostRow(panel, h, hidden),
                )
          }
        </div>
      `,
    )}
    ${section(
      "Keys",
      html`
        <p class="section-note">
          Key pairs in ~/.ssh. Upload a public key from a host's ⋯ menu — the
          private key never leaves this machine.
        </p>
        <div class="host-toolbar">
          <button
            type="button"
            class="tt-btn tt-btn-primary"
            id="set-gen-ssh-key"
            @click=${() => showKeygenModal({ onSaved: () => loadKeys(panel) })}
          >+ Generate Key</button>
        </div>
        <div class="ssh-key-list">${keyList(st)}</div>
      `,
    )}
  `;
}

// Host row (design D4): left checkbox (visibility — pending until Apply),
// meta line, ✎ edit (modal), ⋯ overflow (Clear KnownHosts / Upload SSH
// Key), × delete. No expansion — the edit modal carries the detail.
function hostRow(panel: HTMLElement, h: SshHost, hidden: string[]) {
  const visible = !hidden.includes(h.name);
  const hostname = hostProp(h, "hostname") || h.name;
  const user = hostProp(h, "user") || "root";
  const port = hostProp(h, "port") || "22";
  const identity = hostProp(h, "identityfile");
  const meta = `${user}@${hostname}:${port}${identity ? ` · IdentityFile ${identity}` : ""}`;

  return html`<div class="check-row ssh-host-row ${visible ? "" : "is-off"}" data-name=${h.name}>
    <label class="check-hit">
      <input
        type="checkbox"
        class="check-box ssh-host-vis"
        value=${h.name}
        title="Show in new-tab menu"
        .checked=${visible}
        @change=${(e: Event) => {
          const box = e.currentTarget as HTMLInputElement;
          box.closest(".check-row")?.classList.toggle("is-off", !box.checked);
        }}
      />
      <div class="check-main">
        <div class="check-title ssh-host-name">${h.name}</div>
        <div class="check-meta ssh-host-target">${meta}</div>
      </div>
    </label>
    <div class="check-actions">
      <div class="host-more">
        <button
          type="button"
          class="icon-tiny ssh-btn-more"
          title="More"
          aria-haspopup="true"
          @click=${(e: Event) => {
            e.stopPropagation();
            const menu = (e.currentTarget as HTMLElement)
              .closest(".host-more")
              ?.querySelector(".host-more-menu");
            const wasOpen = menu?.classList.contains("open");
            for (const m of document.querySelectorAll(".host-more-menu.open")) {
              m.classList.remove("open");
            }
            if (!wasOpen) menu?.classList.add("open");
          }}
        >⋯</button>
        <div class="host-more-menu" role="menu">
          <button
            type="button"
            role="menuitem"
            class="ssh-btn-clear"
            @click=${async (e: Event) => {
              (e.currentTarget as HTMLElement).closest(".host-more-menu")?.classList.remove("open");
              try {
                const result: string = await invoke("ssh_clear_known_hosts", { hostname });
                const detail = result.trim();
                showToast(
                  detail
                    ? `Cleared known hosts for ${hostname} — ${detail}`
                    : `Cleared known hosts for ${hostname}`,
                  "info",
                );
              } catch (err) {
                showToast(`Failed to clear known hosts for ${hostname}: ${String(err)}`, "error");
              }
            }}
          >Clear KnownHosts</button>
          <button
            type="button"
            role="menuitem"
            class="ssh-btn-copy-id"
            @click=${(e: Event) => {
              (e.currentTarget as HTMLElement).closest(".host-more-menu")?.classList.remove("open");
              showInstallKeyModal({ hostname, port: parseInt(port, 10) || 22, user });
            }}
          >Upload SSH Key</button>
        </div>
      </div>
      <button
        type="button"
        class="icon-tiny ssh-btn-edit"
        title="Edit"
        @click=${() => showSshHostEditor({ base: h, onSaved: saveHost(panel) })}
      >✎</button>
      <button
        type="button"
        class="icon-tiny ssh-btn-delete"
        title="Delete"
        @click=${() => {
          configStore.set({
            sshHosts: configStore.get("sshHosts").filter((x) => x.name !== h.name),
          });
          setSshConfigDirty(true, panel);
          renderSshPanel(panel);
        }}
      >×</button>
    </div>
  </div>`;
}

function keyList(st: SshPanelState) {
  if (st.keys === null) return ""; // loading — fills async
  if (st.keys.length === 0) {
    return infoRow("No key pairs found. Generate one to enable passwordless logins.");
  }
  return st.keys.map(
    (k) => html`<div class="row">
      <div class="row-info">
        <div class="row-title">${k.name}</div>
        <div class="row-desc">${k.fingerprint}</div>
      </div>
      <div class="row-control">
        ${linkBtn(
          "Copy",
          async () => {
            await navigator.clipboard
              .writeText(k.publicKey)
              .then(() => showToast("Public key copied to clipboard", "info"))
              .catch(logCatch("clipboard.write"));
          },
          { cls: "ssh-key-copy solid" },
        )}
      </div>
    </div>`,
  );
}

// ---- Actions -----------------------------------------------------------

/// Add/Edit result lands in the working copy (pending until the shell's Apply).
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

/// Write the sshHosts working copy to ~/.ssh/config (backend keeps a
/// config.tt.bak backup), then reload so the panel reflects what is
/// actually on disk. Called by the settings shell's Apply — there is no
/// separate Save anymore. Throws on failure: the shell reports and the
/// dirty flag stays set.
export async function saveSshConfigToDisk(from: HTMLElement): Promise<void> {
  const content = generateSshConfig(configStore.get("sshHosts"));
  await invoke<string>("ssh_save_config", { content });
  const hosts = await loadSshHosts();
  configStore.set({ sshHosts: hosts });
  setSshConfigDirty(false, from); // written to disk
  const panel = from.querySelector<HTMLElement>('.settings-panel-content[data-panel="ssh"]');
  if (panel?.isConnected) renderSshPanel(panel);
}

export function collectSshSettings(root: HTMLElement): Partial<ConfigState> {
  const partial: Partial<ConfigState> = {};
  const embeddedEl = root.querySelector<HTMLInputElement>("#set-ssh-embedded");
  if (embeddedEl) partial.sshEmbedded = embeddedEl.getAttribute("aria-checked") === "true";
  // Host visibility checkboxes are pending until Apply (design L3) —
  // hidden = unchecked.
  const hidden: string[] = [];
  for (const box of root.querySelectorAll<HTMLInputElement>(".ssh-host-vis")) {
    if (!box.checked) hidden.push(box.value);
  }
  partial.hiddenSshHosts = hidden;
  return partial;
}
