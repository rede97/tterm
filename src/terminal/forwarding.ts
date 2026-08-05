// Port forwarding dialog — manage local (-L) / remote (-R) forwards for
// tabs running on the embedded SSH client (src-tauri/src/sshclient.rs).

import { invoke } from "@tauri-apps/api/core";
import { showToast } from "../ui/toast";
import { createModal } from "../ui/modal";

interface ForwardInfo {
  forwardId: number;
  kind: string;
  listenHost: string;
  listenPort: number;
  targetHost: string;
  targetPort: number;
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function parsePort(raw: string): number | null {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1 || n > 65535) return null;
  return n;
}

export function showPortForwardingDialog(tabId: string): void {
  // Probe first: non-embedded SSH tabs get a toast instead of the modal.
  invoke<ForwardInfo[]>("ssh_forward_list", { id: tabId })
    .then((forwards) => openDialog(tabId, forwards))
    .catch((err) => {
      if (String(err).includes("not an embedded ssh session")) {
        showToast("Port forwarding requires the built-in SSH client", "error");
      } else {
        showToast(`Failed to list port forwards: ${errText(err)}`, "error");
      }
    });
}

function openDialog(tabId: string, initial: ForwardInfo[]): void {
  const modal = createModal({ className: "fwd-overlay" });
  const overlay = modal.overlay;
  overlay.innerHTML = `
    <div class="fwd-dialog" role="dialog" aria-modal="true" aria-label="Port Forwarding">
      <div class="fwd-header">
        <span>Port Forwarding</span>
        <button class="fwd-close" type="button" title="Close">&#10005;</button>
      </div>
      <div class="fwd-body">
        <div class="fwd-list"></div>
        <div class="fwd-add">
          <div class="fwd-add-title">Add Forward</div>
          <div class="fwd-form">
            <select class="fwd-kind" aria-label="Forward kind">
              <option value="local">Local (-L): listen here, reach remote target</option>
              <option value="remote">Remote (-R): listen on server, reach target from here</option>
            </select>
            <div class="fwd-form-row">
              <input class="fwd-host fwd-listen-host" type="text" value="127.0.0.1" spellcheck="false" aria-label="Listen host" />
              <input class="fwd-port fwd-listen-port" type="number" min="1" max="65535" placeholder="Port" aria-label="Listen port" />
            </div>
            <div class="fwd-arrow">&#8595; forwards to &#8595;</div>
            <div class="fwd-form-row">
              <input class="fwd-host fwd-target-host" type="text" value="127.0.0.1" spellcheck="false" aria-label="Target host" />
              <input class="fwd-port fwd-target-port" type="number" min="1" max="65535" placeholder="Port" aria-label="Target port" />
            </div>
            <button class="fwd-add-btn" type="button">Add</button>
          </div>
        </div>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const listEl = overlay.querySelector<HTMLElement>(".fwd-list")!;
  const kindSelect = overlay.querySelector<HTMLSelectElement>(".fwd-kind")!;
  const listenHostInput = overlay.querySelector<HTMLInputElement>(".fwd-listen-host")!;
  const listenPortInput = overlay.querySelector<HTMLInputElement>(".fwd-listen-port")!;
  const targetHostInput = overlay.querySelector<HTMLInputElement>(".fwd-target-host")!;
  const targetPortInput = overlay.querySelector<HTMLInputElement>(".fwd-target-port")!;

  function renderList(forwards: ForwardInfo[]) {
    listEl.innerHTML = "";
    if (forwards.length === 0) {
      const empty = document.createElement("div");
      empty.className = "fwd-empty";
      empty.textContent = "No active port forwards.";
      listEl.appendChild(empty);
      return;
    }
    for (const f of forwards) {
      const row = document.createElement("div");
      row.className = "fwd-row";

      const badge = document.createElement("span");
      badge.className = `fwd-badge fwd-badge-${f.kind === "remote" ? "remote" : "local"}`;
      badge.textContent = f.kind === "remote" ? "Remote" : "Local";

      const route = document.createElement("span");
      route.className = "fwd-route";
      route.textContent = `${f.listenHost}:${f.listenPort} → ${f.targetHost}:${f.targetPort}`;

      const removeBtn = document.createElement("button");
      removeBtn.className = "fwd-remove";
      removeBtn.type = "button";
      removeBtn.textContent = "Remove";
      removeBtn.addEventListener("click", () => {
        invoke("ssh_forward_remove", { id: tabId, forwardId: f.forwardId })
          .then(refresh)
          .catch((err) => showToast(`Failed to remove port forward: ${errText(err)}`, "error"));
      });

      row.appendChild(badge);
      row.appendChild(route);
      row.appendChild(removeBtn);
      listEl.appendChild(row);
    }
  }

  function refresh(): Promise<void> {
    return invoke<ForwardInfo[]>("ssh_forward_list", { id: tabId })
      .then((forwards) => { renderList(forwards); })
      .catch((err) => { showToast(`Failed to list port forwards: ${errText(err)}`, "error"); });
  }

  overlay.querySelector<HTMLButtonElement>(".fwd-add-btn")!.addEventListener("click", () => {
    const kind = kindSelect.value;
    const listenHost = listenHostInput.value.trim() || "127.0.0.1";
    const targetHost = targetHostInput.value.trim() || "127.0.0.1";
    const listenPort = parsePort(listenPortInput.value);
    const targetPort = parsePort(targetPortInput.value);
    if (listenPort === null || targetPort === null) {
      showToast("Ports must be numbers between 1 and 65535", "error");
      return;
    }
    invoke("ssh_forward_add", { id: tabId, kind, listenHost, listenPort, targetHost, targetPort })
      .then(() => {
        listenPortInput.value = "";
        targetPortInput.value = "";
        return refresh();
      })
      .catch((err) => showToast(`Failed to add port forward: ${errText(err)}`, "error"));
  });

  overlay.querySelector(".fwd-close")!.addEventListener("click", modal.close);

  renderList(initial);
}
