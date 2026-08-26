// SSH host editor modal — one window for both Add and Edit (Settings →
// SSH). Mirrors the serial profile editor / font picker pattern.
//
// Fields: alias, hostname, user, port; boolean options (ForwardAgent,
// ForwardX11) as checkboxes; port forwards as an editable table
// (ui/forwardtable.ts). The result is a working-copy SshHost — nothing is
// written to disk here; the panel's "Save SSH Config" persists.
//
// Edit mode preserves unmanaged directives (IdentityFile,
// ServerAliveInterval, …) untouched; only the keys this editor owns are
// rewritten.

import { esc, hostProp } from "../core/common";
import { configStore } from "../core/store";
import type { SshHost } from "../core/types";
import { mustQuery } from "../ui/dom";
import type { ForwardEditorValue } from "../ui/forwardeditor";
import { createForwardTable, forwardConfigLine, parseForwardLine } from "../ui/forwardtable";
import { createModal } from "../ui/modal";
import { showToast } from "../ui/toast";

export interface SshHostEditorOptions {
  // Edit mode when set (prefills fields, enables rename semantics).
  base?: SshHost;
  onSaved: (host: SshHost, originalName?: string) => void;
}

// Keys this editor owns; everything else on the host passes through.
const MANAGED: Record<string, true> = {
  hostname: true,
  user: true,
  port: true,
  forwardagent: true,
  forwardx11: true,
  localforward: true,
  remoteforward: true,
  dynamicforward: true,
};

const BOOL_OPTIONS: { key: string; label: string; desc: string }[] = [
  { key: "forwardagent", label: "ForwardAgent", desc: "Forward the local ssh-agent to this host" },
  { key: "forwardx11", label: "ForwardX11", desc: "Forward X11 display connections" },
];

function baseForwards(base: SshHost): ForwardEditorValue[] {
  const out: ForwardEditorValue[] = [];
  const collect = (raw: string | undefined, kind: "local" | "remote" | "dynamic") => {
    if (!raw) return;
    for (const line of raw.split("\n")) {
      const r = parseForwardLine(line, kind);
      if (r) out.push(r);
    }
  };
  collect(hostProp(base, "localforward"), "local");
  collect(hostProp(base, "remoteforward"), "remote");
  collect(hostProp(base, "dynamicforward"), "dynamic");
  return out;
}

export function showSshHostEditor(opts: SshHostEditorOptions): void {
  const base = opts.base;
  const originalName = base?.name;

  const modal = createModal({ className: "she-overlay" });
  const overlay = modal.overlay;
  overlay.innerHTML = `
    <div class="she-dialog" role="dialog" aria-modal="true" aria-label="SSH Host Editor">
      <div class="she-header">${base ? "Edit SSH Host" : "New SSH Host"}</div>
      <div class="she-grid">
        <label class="she-field"><span>Alias</span>
          <input class="settings-input she-alias" type="text" spellcheck="false" placeholder="myserver"
                 value="${esc(base?.name ?? "")}" /></label>
        <label class="she-field"><span>User</span>
          <input class="settings-input she-user" type="text" spellcheck="false" placeholder="root"
                 value="${esc(base ? (hostProp(base, "user") ?? "") : "")}" /></label>
        <label class="she-field"><span>HostName</span>
          <input class="settings-input she-hostname" type="text" spellcheck="false" placeholder="default: alias"
                 value="${esc(base ? (hostProp(base, "hostname") ?? "") : "")}" /></label>
        <label class="she-field"><span>Port</span>
          <input class="settings-input she-port" type="number" min="1" max="65535" placeholder="22"
                 value="${esc(base ? (hostProp(base, "port") ?? "") : "")}" /></label>
      </div>
      <div class="she-opts">
        ${BOOL_OPTIONS.map((o) => {
          const on = base ? (hostProp(base, o.key) ?? "").toLowerCase() === "yes" : false;
          return `<label class="settings-toggle-row she-opt" title="${esc(o.desc)}">
            <input type="checkbox" data-key="${o.key}" ${on ? "checked" : ""} />
            <span>${o.label}</span>
          </label>`;
        }).join("")}
      </div>
      <div class="she-fwd-title">Port Forwards <span class="she-fwd-hint">applied on connect</span></div>
      <div class="she-table-slot"></div>
      <div class="she-footer">
        <span class="she-spacer"></span>
        <button class="sp-btn she-cancel" type="button">Cancel</button>
        <button class="sp-btn sp-save she-save" type="button">${base ? "Save" : "Add Host"}</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const table = createForwardTable(base ? baseForwards(base) : []);
  overlay.querySelector(".she-table-slot")?.replaceWith(table.el);

  const aliasInput = mustQuery<HTMLInputElement>(overlay, ".she-alias");
  const hostnameInput = mustQuery<HTMLInputElement>(overlay, ".she-hostname");
  const userInput = mustQuery<HTMLInputElement>(overlay, ".she-user");
  const portInput = mustQuery<HTMLInputElement>(overlay, ".she-port");

  overlay.querySelector(".she-cancel")?.addEventListener("click", modal.close);

  overlay.querySelector(".she-save")?.addEventListener("click", () => {
    const alias = aliasInput.value.trim();
    if (!alias) {
      showToast("Alias is required", "error");
      aliasInput.focus();
      return;
    }
    if (alias.includes("*") || /\s/.test(alias)) {
      showToast("Alias must be a single word without wildcards", "error");
      return;
    }
    const collision = configStore
      .get("sshHosts")
      .some((h) => h.name === alias && h.name !== originalName);
    if (collision) {
      showToast(`A host named "${alias}" already exists`, "error");
      return;
    }
    const portRaw = portInput.value.trim();
    if (portRaw && (!/^\d+$/.test(portRaw) || +portRaw < 1 || +portRaw > 65535)) {
      showToast("Port must be a number between 1 and 65535", "error");
      return;
    }

    // Start from unmanaged directives only (edit mode), then write ours.
    const host: SshHost = { name: alias };
    if (base) {
      for (const [k, v] of Object.entries(base)) {
        if (k !== "name" && !MANAGED[k.toLowerCase()]) host[k] = v;
      }
    }
    const hostname = hostnameInput.value.trim();
    if (hostname && hostname !== alias) host.HostName = hostname;
    const user = userInput.value.trim();
    if (user) host.User = user;
    if (portRaw && portRaw !== "22") host.Port = portRaw;
    overlay.querySelectorAll<HTMLInputElement>(".she-opt input").forEach((cb) => {
      if (cb.checked) host[cb.dataset.key === "forwardx11" ? "ForwardX11" : "ForwardAgent"] = "yes";
    });
    const locals = table
      .rows()
      .filter((r) => r.kind === "local")
      .map(forwardConfigLine);
    const remotes = table
      .rows()
      .filter((r) => r.kind === "remote")
      .map(forwardConfigLine);
    const dynamics = table
      .rows()
      .filter((r) => r.kind === "dynamic")
      .map(forwardConfigLine);
    if (locals.length > 0) host.LocalForward = locals.join("\n");
    if (remotes.length > 0) host.RemoteForward = remotes.join("\n");
    if (dynamics.length > 0) host.DynamicForward = dynamics.join("\n");

    opts.onSaved(host, originalName);
    modal.close();
  });

  aliasInput.focus();
  aliasInput.select();
}
