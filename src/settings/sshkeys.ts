// SSH key management modals — key generation and public-key installation
// (ssh-copy-id equivalent), opened from the SSH settings panel.
//
// The private key never leaves this machine: install uploads the PUBLIC
// key to the target's authorized_keys. Auth during install reuses the
// global password/host-key dialogs when there is no SSH tab (ssh-auth-request).

import { invoke } from "@tauri-apps/api/core";
import { esc } from "../core/common";
import { mustQuery } from "../ui/dom";
import { createModal } from "../ui/modal";
import { showToast } from "../ui/toast";

export interface SshKeyInfo {
  name: string;
  path: string;
  publicKey: string;
  fingerprint: string;
}

export interface InstallTarget {
  hostname: string;
  port: number;
  user: string;
}

export async function listKeys(): Promise<SshKeyInfo[]> {
  try {
    return (await invoke<SshKeyInfo[]>("ssh_list_keys")) ?? [];
  } catch (e) {
    showToast(`Failed to list SSH keys: ${e}`, "error");
    return [];
  }
}

/** Generate-key modal: name, algorithm, optional passphrase. */
export function showKeygenModal(opts: { onSaved: (key: SshKeyInfo) => void }): void {
  const modal = createModal({ className: "she-overlay" });
  modal.overlay.innerHTML = `
    <div class="she-dialog" role="dialog" aria-modal="true" aria-label="Generate SSH Key">
      <div class="she-header">Generate SSH Key</div>
      <div class="she-grid">
        <label class="she-field"><span>Name</span>
          <input class="settings-input skg-name" type="text" spellcheck="false" value="id_ed25519" /></label>
        <label class="she-field"><span>Algorithm</span>
          <select class="settings-input skg-algo">
            <option value="ed25519" selected>Ed25519 (recommended)</option>
            <option value="rsa">RSA 4096</option>
          </select></label>
        <label class="she-field"><span>Passphrase <span style="color:#888">(optional)</span></span>
          <input class="settings-input skg-pass" type="password" placeholder="empty = no passphrase" /></label>
      </div>
      <div class="she-footer">
        <span class="she-spacer"></span>
        <button class="sp-btn skg-cancel" type="button">Cancel</button>
        <button class="sp-btn sp-save skg-save" type="button">Generate</button>
      </div>
    </div>`;
  document.body.appendChild(modal.overlay);

  const nameInput = mustQuery<HTMLInputElement>(modal.overlay, ".skg-name");
  const algoInput = mustQuery<HTMLSelectElement>(modal.overlay, ".skg-algo");
  const passInput = mustQuery<HTMLInputElement>(modal.overlay, ".skg-pass");
  modal.overlay.querySelector(".skg-cancel")?.addEventListener("click", modal.close);
  modal.overlay.querySelector(".skg-save")?.addEventListener("click", async () => {
    try {
      const key = await invoke<SshKeyInfo>("ssh_keygen", {
        algorithm: algoInput.value,
        name: nameInput.value,
        passphrase: passInput.value || null,
      });
      showToast(`Key generated: ${key.fingerprint}`, "info");
      opts.onSaved(key);
      modal.close();
    } catch (e) {
      showToast(String(e), "error");
      nameInput.focus();
    }
  });
  nameInput.focus();
  nameInput.select();
}

/** Install modal: pick a local public key + target OS, upload to the host. */
export function showInstallKeyModal(target: InstallTarget): void {
  const modal = createModal({ className: "she-overlay" });
  modal.overlay.innerHTML = `
    <div class="she-dialog" role="dialog" aria-modal="true" aria-label="Upload SSH Key">
      <div class="she-header">Upload SSH Key → ${esc(target.user)}@${esc(target.hostname)}:${target.port}</div>
      <div class="ski-body" style="padding:0 16px 8px;color:#ccc;font-size:13px;">Loading keys…</div>
      <div class="she-footer">
        <span class="she-spacer"></span>
        <button class="sp-btn ski-cancel" type="button">Cancel</button>
        <button class="sp-btn sp-save ski-install" type="button" disabled>Install</button>
      </div>
    </div>`;
  document.body.appendChild(modal.overlay);

  const body = mustQuery<HTMLElement>(modal.overlay, ".ski-body");
  const installBtn = mustQuery<HTMLButtonElement>(modal.overlay, ".ski-install");
  modal.overlay.querySelector(".ski-cancel")?.addEventListener("click", modal.close);

  listKeys().then((keys) => {
    if (keys.length === 0) {
      body.innerHTML = `No key pairs found in ~/.ssh.
        <button class="settings-link-btn ski-gen" type="button" style="margin-left:8px;">Generate one…</button>`;
      body.querySelector(".ski-gen")?.addEventListener("click", () => {
        modal.close();
        showKeygenModal({ onSaved: () => showInstallKeyModal(target) });
      });
      return;
    }
    body.innerHTML = `
      <div style="margin-bottom:8px;">Public key to authorize on the target:</div>
      <select class="settings-input ski-key" style="width:100%;margin-bottom:10px;">
        ${keys.map((k, i) => `<option value="${i}">${esc(k.name)} — ${esc(k.fingerprint)}</option>`).join("")}
      </select>
      <div style="margin-bottom:4px;">Target system:</div>
      <select class="settings-input ski-os" style="width:100%;">
        <option value="auto" selected>Auto-detect (tries powershell → cmd → sh)</option>
        <option value="windows">Windows</option>
        <option value="linux">Linux</option>
        <option value="macos">macOS</option>
      </select>
      <div style="font-size:12px;color:#888;margin-top:8px;">
        You may be asked for the login password once. Note: on Windows, managed
        (administrator) accounts may require administrators_authorized_keys instead.
      </div>`;
    installBtn.disabled = false;
    installBtn.addEventListener("click", async () => {
      const keySel = body.querySelector<HTMLSelectElement>(".ski-key");
      const key = keySel ? keys[keySel.selectedIndex] : undefined;
      if (!key) return;
      const os = body.querySelector<HTMLSelectElement>(".ski-os")?.value;
      installBtn.disabled = true;
      installBtn.textContent = "Installing…";
      try {
        const res = await invoke<{ outcome: string; shell: string }>("ssh_install_pubkey", {
          spec: {
            hostname: target.hostname,
            port: target.port,
            user: target.user,
            identityFile: null,
          },
          publicKey: key.publicKey,
          targetOs: os === "auto" ? null : os,
        });
        showToast(
          res.outcome === "already"
            ? `${key.name} is already authorized on ${target.hostname} (${res.shell})`
            : `${key.name} installed on ${target.hostname} (${res.shell})`,
          "info",
        );
        modal.close();
      } catch (e) {
        showToast(String(e), "error");
        installBtn.disabled = false;
        installBtn.textContent = "Install";
      }
    });
  });
}
