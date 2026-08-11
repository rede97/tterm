import { describe, it, expect, vi, beforeEach } from "vitest";

// ssh.ts reads the raw config via invoke; the store starts empty.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((cmd: string) => {
    if (cmd === "ssh_read_config_raw") return Promise.resolve("");
    if (cmd === "read_config") return Promise.resolve("{}");
    return Promise.resolve(null);
  }),
}));

import { invoke } from "@tauri-apps/api/core";
import { configStore } from "../src/core/store";
import { createSshPanel } from "../src/settings/ssh";

const invokeMock = vi.mocked(invoke);

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

describe("settings — SSH key management", () => {
  const KEY = {
    name: "id_ed25519",
    path: "/home/u/.ssh/id_ed25519",
    publicKey: "ssh-ed25519 AAAAC3NzaCllZDI1NTE5AAAAItest tterm",
    fingerprint: "SHA256:abc123",
  };

  function mockKeyInvoke(installResult?: { outcome: string; shell: string }) {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "ssh_read_config_raw") return Promise.resolve("");
      if (cmd === "read_config") return Promise.resolve("{}");
      if (cmd === "ssh_list_keys") return Promise.resolve([KEY]);
      if (cmd === "ssh_keygen") return Promise.resolve(KEY);
      if (cmd === "ssh_install_pubkey") {
        return installResult
          ? Promise.resolve(installResult)
          : Promise.reject("auth failed");
      }
      return Promise.resolve(null);
    });
  }

  it("key list renders; Copy writes the public key to the clipboard", async () => {
    mockKeyInvoke();
    const copied: string[] = [];
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: (s: string) => { copied.push(s); return Promise.resolve(); } },
      configurable: true,
    });
    const panel = openPanel();
    await vi.waitFor(() => {
      expect(panel.querySelector(".ssh-key-list")!.textContent).toContain("id_ed25519");
    });
    expect(panel.querySelector(".ssh-key-list")!.textContent).toContain("SHA256:abc123");
    panel.querySelector<HTMLButtonElement>(".ssh-key-copy")!.click();
    await vi.waitFor(() => expect(copied).toEqual([KEY.publicKey]));
  });

  it("Generate Key invokes ssh_keygen with the form values", async () => {
    mockKeyInvoke();
    const panel = openPanel();
    panel.querySelector<HTMLButtonElement>("#set-gen-ssh-key")!.click();
    const overlay = document.querySelector<HTMLElement>(".she-overlay")!;
    expect(overlay.querySelector(".she-header")!.textContent).toBe("Generate SSH Key");
    overlay.querySelector<HTMLInputElement>(".skg-name")!.value = "id_ros2";
    overlay.querySelector<HTMLButtonElement>(".skg-save")!.click();
    await vi.waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("ssh_keygen", {
        algorithm: "ed25519",
        name: "id_ros2",
        passphrase: null,
      });
    });
    await vi.waitFor(() => expect(document.querySelector(".she-overlay")).toBeNull());
  });

  it("Upload SSH Key installs the selected key on the host", async () => {
    mockKeyInvoke({ outcome: "installed", shell: "posix" });
    configStore.set({
      sshHosts: [{ name: "ROS2", HostName: "122.51.226.5", User: "mxq", Port: "5862" }],
    });
    const panel = openPanel();
    panel.querySelector<HTMLButtonElement>(".ssh-btn-copy-id")!.click();
    const overlay = document.querySelector<HTMLElement>(".she-overlay")!;
    expect(overlay.querySelector(".she-header")!.textContent).toContain("mxq@122.51.226.5:5862");

    const installBtn = overlay.querySelector<HTMLButtonElement>(".ski-install")!;
    await vi.waitFor(() => expect(installBtn.disabled).toBe(false));
    overlay.querySelector<HTMLSelectElement>(".ski-os")!.value = "linux";
    installBtn.click();
    await vi.waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("ssh_install_pubkey", {
        spec: { hostname: "122.51.226.5", port: 5862, user: "mxq", identityFile: null },
        publicKey: KEY.publicKey,
        targetOs: "linux",
      });
    });
    await vi.waitFor(() => expect(document.querySelector(".she-overlay")).toBeNull());
  });

  it("empty key list offers to generate one instead", async () => {
    mockKeyInvoke();
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "ssh_list_keys") return Promise.resolve([]);
      if (cmd === "ssh_keygen") return Promise.resolve(KEY);
      if (cmd === "ssh_read_config_raw") return Promise.resolve("");
      if (cmd === "read_config") return Promise.resolve("{}");
      return Promise.resolve(null);
    });
    configStore.set({ sshHosts: [{ name: "ROS2", HostName: "122.51.226.5", User: "mxq" }] });
    const panel = openPanel();
    panel.querySelector<HTMLButtonElement>(".ssh-btn-copy-id")!.click();
    const overlay = document.querySelector<HTMLElement>(".she-overlay")!;
    await vi.waitFor(() => expect(overlay.textContent).toContain("No key pairs found"));
    expect(overlay.querySelector<HTMLButtonElement>(".ski-install")!.disabled).toBe(true);
    // The "Generate one…" shortcut swaps to the keygen modal.
    overlay.querySelector<HTMLButtonElement>(".ski-gen")!.click();
    await vi.waitFor(() => {
      expect(document.querySelector<HTMLElement>(".she-overlay .she-header")!.textContent)
        .toBe("Generate SSH Key");
    });
  });
});
