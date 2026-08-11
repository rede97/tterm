import { describe, it, expect, vi, beforeEach } from "vitest";

// ssh.ts reads the raw config via invoke; the store starts empty.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((cmd: string) => {
    if (cmd === "ssh_read_config_raw") return Promise.resolve("");
    if (cmd === "read_config") return Promise.resolve("{}");
    return Promise.resolve(null);
  }),
}));

import { configStore } from "../src/core/store";
import { createSshPanel } from "../src/settings/ssh";

beforeEach(() => {
  document.body.innerHTML = "";
  configStore.set({ sshHosts: [], hiddenSshHosts: [], sshEmbedded: true });
});

function openPanel(): HTMLElement {
  const panel = createSshPanel();
  document.body.appendChild(panel);
  return panel;
}

function openEditor(): HTMLElement {
  const overlay = document.querySelector<HTMLElement>(".she-overlay");
  expect(overlay, "host editor modal").toBeTruthy();
  return overlay!;
}

/** Fill a group's trailing add-row and commit it. */
function addForwardRow(overlay: HTMLElement, groupIdx: number, opts: {
  listenPort: string; targetHost?: string; targetPort?: string;
}): void {
  const group = overlay.querySelectorAll<HTMLElement>(".ft-group")[groupIdx];
  const addRow = group.querySelector<HTMLElement>(".ft-add-row")!;
  addRow.querySelector<HTMLInputElement>('input[aria-label="Listen port"]')!.value = opts.listenPort;
  if (opts.targetHost !== undefined) {
    addRow.querySelector<HTMLInputElement>('input[aria-label="Target host"]')!.value = opts.targetHost;
    addRow.querySelector<HTMLInputElement>('input[aria-label="Target port"]')!.value = opts.targetPort!;
  }
  addRow.querySelector<HTMLButtonElement>(".ft-add")!.click();
}

const GROUP = { local: 0, remote: 1, dynamic: 2 } as const;

describe("settings — SSH host editor modal", () => {
  it("Add Host opens the modal; alias is required", () => {
    const panel = openPanel();
    panel.querySelector<HTMLButtonElement>("#set-add-ssh-host")!.click();
    const overlay = openEditor();
    expect(overlay.querySelector(".she-header")!.textContent).toBe("New SSH Host");
    overlay.querySelector<HTMLButtonElement>(".she-save")!.click();
    expect(configStore.get("sshHosts")).toHaveLength(0);
    expect(document.querySelector(".she-overlay")).toBeTruthy(); // stays open
  });

  it("rejects a duplicate alias", () => {
    configStore.set({ sshHosts: [{ name: "web", HostName: "10.0.0.1" }] });
    const panel = openPanel();
    panel.querySelector<HTMLButtonElement>("#set-add-ssh-host")!.click();
    const overlay = openEditor();
    overlay.querySelector<HTMLInputElement>(".she-alias")!.value = "web";
    overlay.querySelector<HTMLButtonElement>(".she-save")!.click();
    expect(configStore.get("sshHosts")).toHaveLength(1);
  });

  it("adds a host with options and forwards into the working copy", () => {
    const panel = openPanel();
    panel.querySelector<HTMLButtonElement>("#set-add-ssh-host")!.click();
    const overlay = openEditor();
    overlay.querySelector<HTMLInputElement>(".she-alias")!.value = "db";
    overlay.querySelector<HTMLInputElement>(".she-user")!.value = "deploy";
    overlay.querySelector<HTMLInputElement>('.she-opt input[data-key="forwardagent"]')!.click();

    addForwardRow(overlay, GROUP.local, { listenPort: "8080", targetHost: "db.internal", targetPort: "5432" });
    addForwardRow(overlay, GROUP.remote, { listenPort: "9090", targetHost: "127.0.0.1", targetPort: "3000" });
    addForwardRow(overlay, GROUP.dynamic, { listenPort: "1080" });

    overlay.querySelector<HTMLButtonElement>(".she-save")!.click();
    expect(document.querySelector(".she-overlay")).toBeNull(); // closed
    expect(configStore.get("sshHosts")).toEqual([
      {
        name: "db",
        User: "deploy",
        ForwardAgent: "yes",
        LocalForward: "127.0.0.1:8080 db.internal:5432",
        RemoteForward: "127.0.0.1:9090 127.0.0.1:3000",
        DynamicForward: "127.0.0.1:1080",
      },
    ]);
  });

  it("Edit prefills the modal and preserves unmanaged directives", () => {
    configStore.set({
      sshHosts: [{
        name: "web",
        HostName: "10.0.0.1",
        User: "root",
        IdentityFile: "~/.ssh/id_ed25519",
        LocalForward: "127.0.0.1:8080 127.0.0.1:80",
      }],
    });
    const panel = openPanel();
    panel.querySelector<HTMLButtonElement>(".ssh-btn-edit")!.click();
    const overlay = openEditor();
    expect(overlay.querySelector(".she-header")!.textContent).toBe("Edit SSH Host");
    expect(overlay.querySelector<HTMLInputElement>(".she-alias")!.value).toBe("web");
    expect(overlay.querySelector<HTMLInputElement>(".she-hostname")!.value).toBe("10.0.0.1");
    // Existing forward listed as a table row.
    expect(overlay.querySelectorAll(".ft-row:not(.ft-add-row)")).toHaveLength(1);

    // Rename + drop the forward (delete the row) + save.
    overlay.querySelector<HTMLInputElement>(".she-alias")!.value = "web2";
    overlay.querySelector<HTMLButtonElement>(".ft-del")!.click();
    overlay.querySelector<HTMLButtonElement>(".she-save")!.click();

    expect(configStore.get("sshHosts")).toEqual([
      { name: "web2", HostName: "10.0.0.1", User: "root", IdentityFile: "~/.ssh/id_ed25519" },
    ]);
  });

  it("Cancel closes the modal without touching the host list", () => {
    const panel = openPanel();
    panel.querySelector<HTMLButtonElement>("#set-add-ssh-host")!.click();
    openEditor().querySelector<HTMLButtonElement>(".she-cancel")!.click();
    expect(document.querySelector(".she-overlay")).toBeNull();
    expect(configStore.get("sshHosts")).toHaveLength(0);
  });
});
