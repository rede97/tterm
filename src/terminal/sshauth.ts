// Modal dialogs for the embedded SSH client: password/passphrase prompts and
// host-key (TOFU / mismatch) confirmation. The backend blocks on every request,
// so each prompt MUST be answered exactly once — cancel/dismiss responds too.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { createModal } from "../ui/modal";
import { showToast } from "../ui/toast";

interface SshAuthRequest {
  reqId: number;
  kind: "password" | "passphrase";
  prompt: string;
}

interface SshHostkeyRequest {
  reqId: number;
  host: string;
  port: number;
  keyType: string;
  fingerprint: string;
  mismatch: boolean;
}

let initialized = false;

export function initSshAuthDialogs(): void {
  if (initialized) return;
  initialized = true;

  listen<SshAuthRequest>("ssh-auth-request", (e) => showAuthDialog(e.payload));
  listen<SshHostkeyRequest>("ssh-hostkey-request", (e) => showHostkeyDialog(e.payload));
}

function reportError(err: unknown): void {
  showToast(`SSH response failed: ${err instanceof Error ? err.message : String(err)}`, "error");
}

// -- password / passphrase prompt --

function showAuthDialog(payload: SshAuthRequest): void {
  let responded = false;
  const respond = (secret: string | null): void => {
    if (responded) return;
    responded = true;
    invoke("ssh_auth_response", { reqId: payload.reqId, secret }).catch(reportError);
    modal.close();
  };
  // Every dismissal path (Cancel, Escape, backdrop) answers null — an
  // unanswered prompt would wedge the backend connect.
  const modal = createModal({
    className: "sshauth-overlay",
    onClose: () => respond(null),
    singleton: false,
  });
  const overlay = modal.overlay;
  overlay.innerHTML = `
    <div class="sshauth-dialog">
      <div class="sshauth-header">SSH Authentication</div>
      <div class="sshauth-body">
        <label class="sshauth-label"></label>
        <input type="password" class="sshauth-input" autocomplete="off" />
      </div>
      <div class="sshauth-footer">
        <button class="sshauth-btn sshauth-btn-cancel" type="button">Cancel</button>
        <button class="sshauth-btn sshauth-btn-ok" type="button">OK</button>
      </div>
    </div>
  `;
  overlay.querySelector(".sshauth-label")!.textContent = payload.prompt;
  document.body.appendChild(overlay);

  const input = overlay.querySelector<HTMLInputElement>(".sshauth-input")!;
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      respond(input.value);
    }
  });
  overlay.querySelector(".sshauth-btn-ok")?.addEventListener("click", () => respond(input.value));
  overlay.querySelector(".sshauth-btn-cancel")?.addEventListener("click", () => respond(null));

  input.focus();
}

// -- host key confirmation (TOFU / mismatch) --

function showHostkeyDialog(payload: SshHostkeyRequest): void {
  let responded = false;
  const respond = (accept: boolean): void => {
    if (responded) return;
    responded = true;
    invoke("ssh_hostkey_response", { reqId: payload.reqId, accept }).catch(reportError);
    modal.close();
  };
  // Escape/backdrop = Reject (never auto-trust).
  const modal = createModal({
    className: "sshauth-overlay",
    onClose: () => respond(false),
    singleton: false,
  });
  const overlay = modal.overlay;

  const dialog = document.createElement("div");
  dialog.className = payload.mismatch ? "sshauth-dialog sshauth-dialog-danger" : "sshauth-dialog";

  const header = document.createElement("div");
  header.className = payload.mismatch ? "sshauth-header sshauth-header-danger" : "sshauth-header";
  header.textContent = payload.mismatch ? "WARNING: SSH Host Key CHANGED" : "Unknown SSH Host Key";
  dialog.appendChild(header);

  const body = document.createElement("div");
  body.className = "sshauth-body";

  const desc = document.createElement("div");
  desc.className = "sshauth-text";
  desc.textContent = payload.mismatch
    ? "The host key presented by the server differs from the previously recorded key. " +
      "This could indicate a man-in-the-middle attack, or the server may have been reinstalled or reconfigured."
    : "The authenticity of this host cannot be established. Verify the fingerprint before connecting.";
  body.appendChild(desc);

  const details = document.createElement("div");
  details.className = "sshauth-details";
  const rows: Array<[string, string]> = [
    ["Host", `${payload.host}:${payload.port}`],
    ["Key type", payload.keyType],
    ["Fingerprint", payload.fingerprint],
  ];
  for (const [k, v] of rows) {
    const row = document.createElement("div");
    row.className = "sshauth-detail-row";
    const key = document.createElement("span");
    key.className = "sshauth-detail-key";
    key.textContent = k;
    const val = document.createElement("span");
    val.className = "sshauth-detail-val sshauth-mono";
    val.textContent = v;
    row.appendChild(key);
    row.appendChild(val);
    details.appendChild(row);
  }
  body.appendChild(details);
  dialog.appendChild(body);

  const footer = document.createElement("div");
  footer.className = "sshauth-footer";
  const rejectBtn = document.createElement("button");
  rejectBtn.className = "sshauth-btn sshauth-btn-cancel";
  rejectBtn.type = "button";
  rejectBtn.textContent = "Reject";
  const trustBtn = document.createElement("button");
  trustBtn.className = payload.mismatch
    ? "sshauth-btn sshauth-btn-danger"
    : "sshauth-btn sshauth-btn-ok";
  trustBtn.type = "button";
  trustBtn.textContent = "Trust & Connect";
  footer.appendChild(rejectBtn);
  footer.appendChild(trustBtn);
  dialog.appendChild(footer);

  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  trustBtn.addEventListener("click", () => respond(true));
  rejectBtn.addEventListener("click", () => respond(false));

  trustBtn.focus();
}
