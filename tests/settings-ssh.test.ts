import { beforeEach, describe, expect, it, vi } from "vitest";

// ssh.ts reads the raw config via invoke; the store starts empty.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((cmd: string) => {
    if (cmd === "ssh_read_config_raw") return Promise.resolve("");
    if (cmd === "read_config_file") return Promise.resolve("{}");
    return Promise.resolve(null);
  }),
}));

import { invoke } from "@tauri-apps/api/core";
import { configStore } from "../src/core/store";
import {
  createSshPanel,
  isSshConfigDirty,
  resetSshConfigDirty,
  saveSshConfigToDisk,
  syncSshHostOrder,
} from "../src/settings/ssh";

const invokeMock = vi.mocked(invoke);

beforeEach(() => {
  document.body.innerHTML = "";
  configStore.set({ sshHosts: [], hiddenSshHosts: [], sshEmbedded: true });
  resetSshConfigDirty();
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
function addForwardRow(
  overlay: HTMLElement,
  groupIdx: number,
  opts: {
    listenPort: string;
    targetHost?: string;
    targetPort?: string;
  },
): void {
  const group = overlay.querySelectorAll<HTMLElement>(".ft-group")[groupIdx];
  const addRow = group.querySelector<HTMLElement>(".ft-add-row")!;
  addRow.querySelector<HTMLInputElement>('input[aria-label="Listen port"]')!.value =
    opts.listenPort;
  if (opts.targetHost !== undefined) {
    addRow.querySelector<HTMLInputElement>('input[aria-label="Target host"]')!.value =
      opts.targetHost;
    addRow.querySelector<HTMLInputElement>('input[aria-label="Target port"]')!.value =
      opts.targetPort!;
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

    addForwardRow(overlay, GROUP.local, {
      listenPort: "8080",
      targetHost: "db.internal",
      targetPort: "5432",
    });
    addForwardRow(overlay, GROUP.remote, {
      listenPort: "9090",
      targetHost: "127.0.0.1",
      targetPort: "3000",
    });
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
      sshHosts: [
        {
          name: "web",
          HostName: "10.0.0.1",
          User: "root",
          IdentityFile: "~/.ssh/id_ed25519",
          LocalForward: "127.0.0.1:8080 127.0.0.1:80",
        },
      ],
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
      if (cmd === "read_config_file") return Promise.resolve("{}");
      if (cmd === "ssh_list_keys") return Promise.resolve([KEY]);
      if (cmd === "ssh_keygen") return Promise.resolve(KEY);
      if (cmd === "ssh_install_pubkey") {
        return installResult ? Promise.resolve(installResult) : Promise.reject("auth failed");
      }
      return Promise.resolve(null);
    });
  }

  it("key list renders; Copy writes the public key to the clipboard", async () => {
    mockKeyInvoke();
    const copied: string[] = [];
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: (s: string) => {
          copied.push(s);
          return Promise.resolve();
        },
      },
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
      if (cmd === "read_config_file") return Promise.resolve("{}");
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
      expect(document.querySelector<HTMLElement>(".she-overlay .she-header")!.textContent).toBe(
        "Generate SSH Key",
      );
    });
  });
});

describe("settings — SSH host list order & detail", () => {
  it("drag order syncs the working copy (pending until save)", () => {
    configStore.set({
      sshHosts: [
        { name: "a", HostName: "10.0.0.1" },
        { name: "b", HostName: "10.0.0.2" },
        { name: "c", HostName: "10.0.0.3" },
      ],
    });
    const panel = openPanel();
    const list = panel.querySelector<HTMLElement>(".ssh-host-list")!;
    const cards = list.querySelectorAll<HTMLElement>(".ssh-host-card");
    expect(cards).toHaveLength(3);
    list.insertBefore(cards[2], cards[0]); // Sortable's DOM move: c, a, b
    syncSshHostOrder(list);
    expect(configStore.get("sshHosts").map((h) => h.name)).toEqual(["c", "a", "b"]);
  });

  it("sync refuses to drop hosts when DOM and store disagree", () => {
    configStore.set({
      sshHosts: [
        { name: "a", HostName: "10.0.0.1" },
        { name: "b", HostName: "10.0.0.2" },
      ],
    });
    const panel = openPanel();
    const list = panel.querySelector<HTMLElement>(".ssh-host-list")!;
    list.querySelector<HTMLElement>('.ssh-host-card[data-name="b"]')!.remove();
    syncSshHostOrder(list);
    expect(configStore.get("sshHosts").map((h) => h.name)).toEqual(["a", "b"]);
  });

  it("expanding marks the card non-draggable and lists one property per line", () => {
    configStore.set({
      sshHosts: [
        { name: "a", HostName: "10.0.0.1", IdentityFile: "~/.ssh/id_ed25519", ForwardAgent: "yes" },
      ],
    });
    const panel = openPanel();
    const card = panel.querySelector<HTMLElement>(".ssh-host-card")!;
    expect(card.classList.contains("expanded")).toBe(false);
    card.querySelector<HTMLElement>(".ssh-host-row")!.click();
    expect(card.classList.contains("expanded")).toBe(true);
    const lines = card.querySelectorAll(".ssh-host-extra > div");
    expect(lines.length).toBe(2); // one per line, not joined with separators
    expect(card.querySelector(".ssh-host-extra")!.textContent).not.toContain("·");
  });
});

describe("settings — SSH config dirty state", () => {
  it("clean initially, dirty after Delete, clean again after Apply writes the file", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "ssh_save_config") return Promise.resolve("Saved to ~/.ssh/config");
      if (cmd === "ssh_read_config_raw") return Promise.resolve("");
      if (cmd === "read_config_file") return Promise.resolve("{}");
      return Promise.resolve(null);
    });
    configStore.set({ sshHosts: [{ name: "a", HostName: "10.0.0.1" }] });
    const panel = openPanel();
    expect(isSshConfigDirty()).toBe(false);

    panel.querySelector<HTMLButtonElement>(".ssh-btn-delete")!.click();
    expect(isSshConfigDirty()).toBe(true);

    // No separate Save button anymore — the shell's Apply writes
    // ~/.ssh/config (no confirmation dialog; the backend keeps a backup).
    expect(panel.querySelector("#set-save-ssh-config")).toBeNull();
    await saveSshConfigToDisk(panel);
    expect(invokeMock).toHaveBeenCalledWith("ssh_save_config", expect.anything());
    expect(isSshConfigDirty()).toBe(false);
  });

  it("drag reorder marks dirty and fires tterm-ssh-dirty (bubbles)", () => {
    configStore.set({
      sshHosts: [
        { name: "a", HostName: "10.0.0.1" },
        { name: "b", HostName: "10.0.0.2" },
      ],
    });
    const panel = openPanel();
    const events: boolean[] = [];
    panel.addEventListener("tterm-ssh-dirty", (e) => events.push((e as CustomEvent).detail));
    const list = panel.querySelector<HTMLElement>(".ssh-host-list")!;
    const cards = list.querySelectorAll<HTMLElement>(".ssh-host-card");
    list.insertBefore(cards[1], cards[0]);
    syncSshHostOrder(list);
    expect(isSshConfigDirty()).toBe(true);
    expect(events).toEqual([true]);
  });

  it("Reload clears the dirty state", async () => {
    configStore.set({ sshHosts: [{ name: "a", HostName: "10.0.0.1" }] });
    const panel = openPanel();
    panel.querySelector<HTMLButtonElement>(".ssh-btn-delete")!.click();
    expect(isSshConfigDirty()).toBe(true);
    panel.querySelector<HTMLButtonElement>("#set-reload-ssh")!.click();
    await vi.waitFor(() => expect(isSshConfigDirty()).toBe(false));
  });
});

describe("settings — SSH panel lit-html rendering (pilot acceptance)", () => {
  const twoHosts = [
    { name: "a", HostName: "10.0.0.1", IdentityFile: "~/.ssh/id_a" },
    { name: "b", HostName: "10.0.0.2" },
  ];

  it("re-render after Delete keeps sibling cards expanded (no collapse)", () => {
    configStore.set({ sshHosts: twoHosts });
    const panel = openPanel();
    const cardA = panel.querySelector<HTMLElement>('.ssh-host-card[data-name="a"]')!;
    cardA.querySelector<HTMLElement>(".ssh-host-row")!.click();
    expect(cardA.classList.contains("expanded")).toBe(true);

    panel
      .querySelector<HTMLButtonElement>('.ssh-host-card[data-name="b"] .ssh-btn-delete')!
      .click();

    const after = panel.querySelector<HTMLElement>('.ssh-host-card[data-name="a"]')!;
    expect(after.classList.contains("expanded")).toBe(true);
    // The surviving card's detail DOM is the SAME node — not rebuilt.
    expect(after.querySelector(".ssh-host-extra")!.textContent).toContain("IdentityFile");
  });

  it("pending Built-in toggle survives internal re-renders (keepPending is dead)", () => {
    configStore.set({ sshHosts: twoHosts, sshEmbedded: true });
    const panel = openPanel();
    const on = () =>
      panel.querySelector<HTMLElement>("#set-ssh-embedded")!.getAttribute("aria-checked");
    expect(on()).toBe("true");
    panel.querySelector<HTMLElement>("#set-ssh-embedded")!.click(); // pending, not applied
    expect(on()).toBe("false");

    // Any internal re-render (here: Delete) must not reset the toggle to
    // the stored value — the old keepPending hack's entire job.
    panel
      .querySelector<HTMLButtonElement>('.ssh-host-card[data-name="b"] .ssh-btn-delete')!
      .click();
    expect(on()).toBe("false");
  });

  it("revert resets the pending toggle to the stored value", async () => {
    configStore.set({ sshHosts: twoHosts, sshEmbedded: true });
    const panel = openPanel();
    panel.querySelector<HTMLElement>("#set-ssh-embedded")!.click();
    const { refreshSshPanel } = await import("../src/settings/ssh");
    // refreshSshPanel takes the settings page root; our bare panel works
    // because it IS the [data-panel="ssh"] element's own subtree root.
    const page = document.createElement("div");
    page.appendChild(panel);
    refreshSshPanel(page);
    expect(
      panel.querySelector<HTMLElement>("#set-ssh-embedded")!.getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("list element identity survives re-renders (Sortable binding stays live)", () => {
    configStore.set({ sshHosts: twoHosts });
    const panel = openPanel();
    const listBefore = panel.querySelector<HTMLElement>(".ssh-host-list")!;
    const cardABefore = panel.querySelector<HTMLElement>('.ssh-host-card[data-name="a"]')!;

    panel
      .querySelector<HTMLButtonElement>('.ssh-host-card[data-name="b"] .ssh-btn-delete')!
      .click();

    expect(panel.querySelector<HTMLElement>(".ssh-host-list")).toBe(listBefore);
    // Keyed repeat: surviving card node is patched, not replaced.
    expect(panel.querySelector<HTMLElement>('.ssh-host-card[data-name="a"]')).toBe(cardABefore);
  });
});
