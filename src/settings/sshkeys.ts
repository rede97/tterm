// SSH key management modals — key generation and public-key installation
// (ssh-copy-id equivalent), opened from the SSH settings panel.
//
// The private key never leaves this machine: install uploads the PUBLIC
// key to the target's authorized_keys. Auth during install reuses the
// global password/host-key dialogs when there is no SSH tab (ssh-auth-request).

import { invoke } from "@tauri-apps/api/core";
import { esc } from "../core/common";
import { mustQuery } from "../ui/dom";
import { render } from "../ui/lit";
import { createModal } from "../ui/modal";
import { syncSelectTexts, ttSelect } from "../ui/select";
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
    <div class="she-dialog she-dialog--sm" role="dialog" aria-modal="true" aria-label="Generate SSH Key">
      <div class="she-header">Generate SSH Key</div>
      <div class="she-grid">
        <label class="she-field"><span>Name</span>
          <input class="settings-input skg-name" type="text" spellcheck="false" value="id_ed25519" /></label>
        <label class="she-field"><span>Algorithm</span>
          <span class="skg-algo-slot"></span></label>
        <label class="she-field"><span>Passphrase <span style="color:#888">(optional)</span></span>
          <input class="settings-input skg-pass" type="password" placeholder="empty = no passphrase" /></label>
      </div>
      <div class="she-footer">
        <span class="she-spacer"></span>
        <button class="tt-btn tt-btn-ghost skg-cancel" type="button">Cancel</button>
        <button class="tt-btn tt-btn-primary skg-save" type="button">Generate</button>
      </div>
    </div>`;
  document.body.appendChild(modal.overlay);

  const nameInput = mustQuery<HTMLInputElement>(modal.overlay, ".skg-name");
  const passInput = mustQuery<HTMLInputElement>(modal.overlay, ".skg-pass");
  // Shared custom select (design: no native menus in settings).
  let algo = "ed25519";
  const algoSlot = mustQuery<HTMLElement>(modal.overlay, ".skg-algo-slot");
  render(
    ttSelect(
      "Algorithm",
      [
        ["ed25519", "Ed25519 (recommended)"],
        ["rsa", "RSA 4096"],
      ],
      algo,
      (v) => {
        algo = v;
      },
      { id: "skg-algo" },
    ),
    algoSlot,
  );
  syncSelectTexts(algoSlot);
  modal.overlay.querySelector(".skg-cancel")?.addEventListener("click", modal.close);
  modal.overlay.querySelector(".skg-save")?.addEventListener("click", async () => {
    try {
      const key = await invoke<SshKeyInfo>("ssh_keygen", {
        algorithm: algo,
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
    <div class="she-dialog she-dialog--sm" role="dialog" aria-modal="true" aria-label="Upload SSH Key">
      <div class="she-header">Upload SSH Key</div>
      <p class="ski-desc" style="margin:-6px 0 10px;font-size:12px;color:var(--tt-muted);">Install a local public key on ${esc(target.user)}@${esc(target.hostname)}:${target.port}. The private key never leaves this machine.</p>
      <div class="ski-body" style="padding:0 0 8px;color:#ccc;font-size:13px;">Loading keys…</div>
      <div class="she-footer">
        <span class="she-spacer"></span>
        <button class="tt-btn tt-btn-ghost ski-cancel" type="button">Cancel</button>
        <button class="tt-btn tt-btn-primary ski-install" type="button" disabled>Install</button>
      </div>
    </div>`;
  document.body.appendChild(modal.overlay);

  const body = mustQuery<HTMLElement>(modal.overlay, ".ski-body");
  const installBtn = mustQuery<HTMLButtonElement>(modal.overlay, ".ski-install");
  modal.overlay.querySelector(".ski-cancel")?.addEventListener("click", modal.close);

  listKeys().then((keys) => {
    if (keys.length === 0) {
      body.innerHTML = `No key pairs found in ~/.ssh.
        <button class="tt-btn-link ski-gen" type="button" style="margin-left:8px;">Generate one…</button>`;
      body.querySelector(".ski-gen")?.addEventListener("click", () => {
        modal.close();
        showKeygenModal({ onSaved: () => showInstallKeyModal(target) });
      });
      return;
    }
    body.innerHTML = `
      <div class="ski-field"><span style="display:block;font-size:12px;margin-bottom:4px;">Public key</span>
        <div class="ski-key-slot" style="margin-bottom:10px;"></div></div>
      <div class="ski-field"><span style="display:block;font-size:12px;margin-bottom:4px;">Target OS</span>
        <div class="ski-os-slot"></div></div>
      <div style="font-size:12px;color:#888;margin-top:8px;">
        You may be asked for the login password once. Note: on Windows, managed
        (administrator) accounts may require administrators_authorized_keys instead.
      </div>`;
    // Shared custom selects (design: no native menus in settings).
    let keyIdx = "0";
    let os = "auto";
    const keySlot = mustQuery<HTMLElement>(body, ".ski-key-slot");
    render(
      ttSelect(
        "Public key",
        keys.map((k, i) => [String(i), `${k.name} — ${k.fingerprint}`] as const),
        keyIdx,
        (v) => {
          keyIdx = v;
        },
        { id: "ski-key" },
      ),
      keySlot,
    );
    syncSelectTexts(keySlot);
    const osSlot = mustQuery<HTMLElement>(body, ".ski-os-slot");
    render(
      ttSelect(
        "Target OS",
        [
          ["auto", "Auto"],
          ["windows", "Windows"],
          ["linux", "Linux"],
          ["macos", "macOS"],
        ],
        os,
        (v) => {
          os = v;
        },
        { id: "ski-os" },
      ),
      osSlot,
    );
    syncSelectTexts(osSlot);
    installBtn.disabled = false;
    installBtn.addEventListener("click", async () => {
      const key = keys[parseInt(keyIdx, 10)];
      if (!key) return;
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
