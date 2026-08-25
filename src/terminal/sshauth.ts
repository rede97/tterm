// SSH auth prompts: password/passphrase and host-key (TOFU / mismatch).
// The backend blocks on every request, so each prompt MUST be answered
// exactly once — cancel/dismiss responds too.
//
// Secrets for an on-screen SSH tab are collected in that tab's xterm
// (OpenSSH-style, no echo). Host-key confirmation stays a modal. Settings
// key-install and any prompt with no tab fall back to the password dialog.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { mustQuery } from "../ui/dom";
import { createModal } from "../ui/modal";
import { showToast } from "../ui/toast";

interface SshAuthRequest {
  reqId: number;
  kind: "password" | "passphrase";
  prompt: string;
  sessionId?: string;
}

interface SshHostkeyRequest {
  reqId: number;
  host: string;
  port: number;
  keyType: string;
  fingerprint: string;
  mismatch: boolean;
}

/** Minimal xterm surface used to collect a secret without importing TabManager. */
export interface SecretPromptTarget {
  id: string;
  terminal: {
    write(data: string): void;
    focus(): void;
    onData(cb: (data: string) => void): { dispose(): void };
  };
  /** Pause WS-bound keystrokes while a secret is collected (reconnect). */
  muteInput?(muted: boolean): void;
}

let initialized = false;
let promptTab: SecretPromptTarget | null = null;
let tabLookup: ((sessionId?: string) => SecretPromptTarget | undefined) | null = null;

let collector: {
  tabId: string;
  respond: (secret: string | null) => void;
} | null = null;

export function setSshSecretPromptTab(tab: SecretPromptTarget | null): void {
  promptTab = tab;
}

export function setSshAuthTabLookup(
  fn: ((sessionId?: string) => SecretPromptTarget | undefined) | null,
): void {
  tabLookup = fn;
}

/** Answer an in-flight in-terminal prompt with null (tab closed). */
export function cancelSshSecretPromptFor(tabId: string): void {
  if (collector?.tabId === tabId) collector.respond(null);
}

export function initSshAuthDialogs(): void {
  if (initialized) return;
  initialized = true;

  listen<SshAuthRequest>("ssh-auth-request", (e) => showAuthPrompt(e.payload));
  listen<SshHostkeyRequest>("ssh-hostkey-request", (e) => showHostkeyDialog(e.payload));
}

function reportError(err: unknown): void {
  showToast(`SSH response failed: ${err instanceof Error ? err.message : String(err)}`, "error");
}

function resolveSecretTab(sessionId?: string): SecretPromptTarget | undefined {
  // No sessionId → Settings key-install (and any other no-tab caller): modal.
  if (!sessionId) return undefined;
  return tabLookup?.(sessionId) ?? promptTab ?? undefined;
}

function showAuthPrompt(payload: SshAuthRequest): void {
  const tab = resolveSecretTab(payload.sessionId);
  if (tab) {
    collectSecretInTerminal(tab, payload);
    return;
  }
  showAuthDialog(payload);
}

function collectSecretInTerminal(tab: SecretPromptTarget, payload: SshAuthRequest): void {
  collector?.respond(null);

  let responded = false;
  let buf = "";
  let disposable: { dispose(): void } | undefined;

  const respond = (secret: string | null): void => {
    if (responded) return;
    responded = true;
    collector = null;
    disposable?.dispose();
    tab.muteInput?.(false);
    tab.terminal.write("\r\n");
    invoke("ssh_auth_response", { reqId: payload.reqId, secret }).catch(reportError);
  };

  collector = { tabId: tab.id, respond };
  tab.muteInput?.(true);
  const prompt = payload.prompt.endsWith(" ") ? payload.prompt : `${payload.prompt} `;
  tab.terminal.write(`\r\n${prompt}`);
  tab.terminal.focus();

  disposable = tab.terminal.onData((data) => {
    if (responded) return;
    // Bare Escape cancels. CSI / other ESC sequences (arrows) must not.
    if (data === "\x1b") {
      respond(null);
      return;
    }
    if (data.startsWith("\x1b")) return;
    for (const ch of data) {
      if (ch === "\r" || ch === "\n") {
        respond(buf);
        return;
      }
      if (ch === "\x03") {
        respond(null);
        return;
      }
      if (ch === "\x7f" || ch === "\b") {
        buf = buf.slice(0, -1);
      } else if (ch >= " ") {
        buf += ch;
      }
    }
  });
}

// -- password / passphrase prompt (no tab: Settings key-install) --

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
  mustQuery(overlay, ".sshauth-label").textContent = payload.prompt;
  document.body.appendChild(overlay);

  const input = mustQuery<HTMLInputElement>(overlay, ".sshauth-input");
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
