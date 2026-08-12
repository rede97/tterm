// Directional port-forward endpoint editor — shared by the forwarding
// dialog (terminal/forwarding.ts), the quick panel (terminal/quickpanel.ts)
// and the SSH host form (settings/ssh.ts).
//
// Two endpoint columns (Local / Remote) with a direction arrow between
// them. The arrow IS the kind switch:
//   →  local (-L): listen here,          target on the remote side
//   ←  remote (-R): listen on the server, target on the local side
// Only the target side's host is editable; the listen side is pinned to
// 127.0.0.1 (OpenSSH's default bind address) and disabled. Toggling the
// arrow flips which column is locked.

export type ForwardKind = "local" | "remote" | "dynamic";

import { el } from "./dom";

export interface ForwardEditorValue {
  kind: ForwardKind;
  listenHost: string;
  listenPort: number;
  targetHost: string;
  targetPort: number;
}

export interface ForwardEditor {
  el: HTMLElement;
  /** Read the current spec; null when a port is empty or out of range. */
  read(): ForwardEditorValue | null;
  /** Clear both ports (hosts survive), e.g. after a successful Add. */
  reset(): void;
  kind(): ForwardKind;
}

const LOOPBACK = "127.0.0.1";

function parsePort(raw: string): number | null {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1 || n > 65535) return null;
  return n;
}

interface Endpoint {
  host: HTMLInputElement;
  port: HTMLInputElement;
}

function mkEndpoint(
  colLabel: string,
  hostAria: string,
  portAria: string,
): Endpoint & { col: HTMLElement } {
  const col = el("div", "xfe-col");
  col.appendChild(el("div", "xfe-col-title", colLabel));
  const fields = el("div", "xfe-fields");
  const host = document.createElement("input");
  host.className = "xfe-host";
  host.type = "text";
  host.spellcheck = false;
  host.setAttribute("aria-label", hostAria);
  const port = document.createElement("input");
  port.className = "xfe-port";
  port.type = "number";
  port.min = "1";
  port.max = "65535";
  port.placeholder = "Port";
  port.setAttribute("aria-label", portAria);
  fields.appendChild(host);
  fields.appendChild(port);
  col.appendChild(fields);
  return { col, host, port };
}

export function createForwardEditor(opts?: { stacked?: boolean }): ForwardEditor {
  // stacked: vertical layout for narrow containers (quick panel) — each
  // endpoint gets a full-width row so IPs are never clipped.
  const root = el("div", opts?.stacked ? "xfe xfe-stacked" : "xfe");
  const local = mkEndpoint("Local", "Local host", "Local port");
  const remote = mkEndpoint("Remote", "Remote host", "Remote port");
  const arrow = document.createElement("button");
  arrow.type = "button";
  arrow.className = "xfe-arrow";
  arrow.setAttribute("aria-label", "Toggle forward direction");

  // Per-side editable host memory: the locked side shows 127.0.0.1 while
  // its typed value waits for the direction to flip back.
  let localHost = LOOPBACK;
  let remoteHost = LOOPBACK;
  let dir: ForwardKind = "local";

  function apply(): void {
    // dir "local" (→): Local is the listen side (locked), Remote the target.
    const lockLocal = dir === "local";
    local.host.disabled = lockLocal;
    remote.host.disabled = !lockLocal;
    local.host.value = lockLocal ? LOOPBACK : localHost;
    remote.host.value = lockLocal ? remoteHost : LOOPBACK;
    // The editable target side advertises its empty-default; the locked
    // side shows the pinned value, so no placeholder is needed there.
    local.host.placeholder = lockLocal ? "" : `${LOOPBACK} (default)`;
    remote.host.placeholder = lockLocal ? `${LOOPBACK} (default)` : "";
    local.host.classList.toggle("xfe-locked", lockLocal);
    remote.host.classList.toggle("xfe-locked", !lockLocal);
    arrow.textContent = dir === "local" ? "→" : "←";
    arrow.title =
      dir === "local"
        ? "Local → Remote (-L): listen here, reach a remote target. Click to flip."
        : "Remote → Local (-R): listen on the server, reach a target from here. Click to flip.";
  }

  local.host.addEventListener("input", () => {
    if (!local.host.disabled) localHost = local.host.value;
  });
  remote.host.addEventListener("input", () => {
    if (!remote.host.disabled) remoteHost = remote.host.value;
  });
  arrow.addEventListener("click", () => {
    dir = dir === "local" ? "remote" : "local";
    apply();
  });

  root.appendChild(local.col);
  root.appendChild(arrow);
  root.appendChild(remote.col);
  apply();

  return {
    el: root,
    kind: () => dir,
    read(): ForwardEditorValue | null {
      const localPort = parsePort(local.port.value);
      const remotePort = parsePort(remote.port.value);
      if (localPort === null || remotePort === null) return null;
      if (dir === "local") {
        return {
          kind: "local",
          listenHost: LOOPBACK,
          listenPort: localPort,
          targetHost: remoteHost.trim() || LOOPBACK,
          targetPort: remotePort,
        };
      }
      return {
        kind: "remote",
        listenHost: LOOPBACK,
        listenPort: remotePort,
        targetHost: localHost.trim() || LOOPBACK,
        targetPort: localPort,
      };
    },
    reset(): void {
      local.port.value = "";
      remote.port.value = "";
    },
  };
}

/** One-line route rendering shared by forward lists: badges + arrow. */
export function formatForwardRoute(f: {
  kind: string;
  listenHost: string;
  listenPort: number;
  targetHost: string;
  targetPort: number;
}): string {
  return `${f.listenHost}:${f.listenPort} → ${f.targetHost}:${f.targetPort}`;
}
