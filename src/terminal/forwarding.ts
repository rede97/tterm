// Port forwarding — manage local (-L) / remote (-R) forwards for tabs
// running on the embedded SSH client (src-tauri/src/sshclient.rs).
//
// The invoke calls AND their error toasts live here exactly once
// (listForwards / addForward / removeForward / toastInvalidPorts): the
// modal below and the quick panel (quickpanel.ts) are two views of the
// same operations and must give identical feedback.

import { invoke } from "@tauri-apps/api/core";
import { createForwardEditor } from "../ui/forwardeditor";
import { createModal } from "../ui/modal";
import { showToast } from "../ui/toast";

export interface ForwardInfo {
  forwardId: number;
  kind: string;
  listenHost: string;
  listenPort: number;
  targetHost: string;
  targetPort: number;
}

export interface NewForward {
  kind: string;
  listenHost: string;
  listenPort: number;
  targetHost: string;
  targetPort: number;
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// The shared rejection toast for an incomplete/invalid editor read.
export function toastInvalidPorts(): void {
  showToast("Ports must be numbers between 1 and 65535", "error");
}

// null on failure (toast already shown).
export async function listForwards(tabId: string): Promise<ForwardInfo[] | null> {
  try {
    return await invoke<ForwardInfo[]>("ssh_forward_list", { id: tabId });
  } catch (err) {
    showToast(`Failed to list port forwards: ${errText(err)}`, "error");
    return null;
  }
}

// Returns the backend forward id (needed later by removeForward); null on
// failure (toast already shown).
export async function addForward(tabId: string, forward: NewForward): Promise<number | null> {
  try {
    return await invoke<number>("ssh_forward_add", { id: tabId, ...forward });
  } catch (err) {
    showToast(`Failed to add port forward: ${errText(err)}`, "error");
    return null;
  }
}

export async function removeForward(tabId: string, forwardId: number): Promise<boolean> {
  try {
    await invoke("ssh_forward_remove", { id: tabId, forwardId });
    return true;
  } catch (err) {
    showToast(`Failed to remove port forward: ${errText(err)}`, "error");
    return false;
  }
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
            <div class="fwd-editor-slot"></div>
            <button class="fwd-add-btn" type="button">Add</button>
          </div>
        </div>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const listEl = overlay.querySelector<HTMLElement>(".fwd-list")!;
  const editor = createForwardEditor();
  overlay.querySelector(".fwd-editor-slot")?.replaceWith(editor.el);

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
      route.title = route.textContent;

      const removeBtn = document.createElement("button");
      removeBtn.className = "fwd-remove";
      removeBtn.type = "button";
      removeBtn.textContent = "Remove";
      removeBtn.addEventListener("click", () => {
        removeForward(tabId, f.forwardId).then((ok) => {
          if (ok) refresh();
        });
      });

      row.appendChild(badge);
      row.appendChild(route);
      row.appendChild(removeBtn);
      listEl.appendChild(row);
    }
  }

  function refresh(): Promise<void> {
    return listForwards(tabId).then((forwards) => {
      if (forwards) renderList(forwards);
    });
  }

  overlay.querySelector<HTMLButtonElement>(".fwd-add-btn")?.addEventListener("click", () => {
    const spec = editor.read();
    if (!spec) {
      toastInvalidPorts();
      return;
    }
    addForward(tabId, spec).then((id) => {
      if (id === null) return;
      editor.reset();
      refresh();
    });
  });

  overlay.querySelector(".fwd-close")?.addEventListener("click", modal.close);

  renderList(initial);
}
