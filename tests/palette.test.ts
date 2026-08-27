import { beforeEach, describe, expect, it, vi } from "vitest";

const { sshHistoryFile } = vi.hoisted(() => ({ sshHistoryFile: { content: "[]" } }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((cmd: string, args?: { name?: string; content?: string }) => {
    if (cmd === "read_config_file" && args?.name === "ssh-history") {
      return Promise.resolve(sshHistoryFile.content);
    }
    if (cmd === "write_config_file" && args?.name === "ssh-history") {
      sshHistoryFile.content = args.content ?? "[]";
      return Promise.resolve(null);
    }
    return Promise.resolve(null);
  }),
}));

import { invoke } from "@tauri-apps/api/core";
import { setSshHistory } from "../src/config/ssh-history";
import { initKeymap } from "../src/core/keymap";
import { configStore } from "../src/core/store";
import type { SshHost } from "../src/core/types";
import {
  openCommandPalette,
  openPaletteFlow,
  type PaletteHandlers,
  paletteOpen,
  setPaletteHandlers,
} from "../src/ui/palette";

// runCommand routes through the keymap handler table — a Proxy resolves
// every command id to a spy.
const fired: string[] = [];
initKeymap(new Proxy({}, { get: (_, id) => () => fired.push(String(id)) }) as never);

const sshTabs: { host: SshHost; password?: string }[] = [];
const serialCalls: string[] = [];
let flippedTo: string | null = null;
let activeTab: {
  id: string;
  type: string;
  sshEmbedded?: boolean;
  shared?: boolean;
} | null = {
  id: "tab-1",
  type: "local",
};

const invokeMock = vi.mocked(invoke);

const handlers: PaletteHandlers = {
  listLocalProfiles: () => [
    { name: "PowerShell", command: "pwsh.exe" },
    { name: "CMD", command: "cmd.exe" },
  ],
  listSshHosts: () => [{ name: "pi", hostname: "192.168.1.42", user: "pi" }],
  listSerialPorts: () =>
    Promise.resolve([
      { name: "COM3", driver: "usb", manufacturer: "", product: "USB Serial", vid: "", pid: "" },
    ]),
  openLocalTab: vi.fn(),
  openSshTab: (host, password) => sshTabs.push({ host, password }),
  openSerialTab: vi.fn(),
  getActiveTab: () => activeTab,
  setSerialBaud: (id, baud) => serialCalls.push(`baud:${id}:${baud}`),
  setSerialProfile: (id, name) => serialCalls.push(`profile:${id}:${name}`),
  setSerialFlow: (id, flow) => serialCalls.push(`flow:${id}:${flow}`),
  setSerialInputMode: (id, mode) => serialCalls.push(`input:${id}:${mode}`),
  flipToQuickOpen: (q) => {
    flippedTo = q;
  },
};
setPaletteHandlers(handlers);

function input(): HTMLInputElement {
  return document.querySelector<HTMLInputElement>(".pal-panel .pal-input")!;
}
function rowTexts(): string[] {
  return [...document.querySelectorAll<HTMLElement>(".pal-row .pal-label")].map(
    (r) => r.textContent ?? "",
  );
}
function rowFullTexts(): string[] {
  return [...document.querySelectorAll<HTMLElement>(".pal-row")].map((r) => r.textContent ?? "");
}
function key(key: string): void {
  input().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
}
function type(value: string): void {
  input().value = value;
  input().dispatchEvent(new Event("input", { bubbles: true }));
}

beforeEach(() => {
  fired.length = 0;
  sshTabs.length = 0;
  serialCalls.length = 0;
  flippedTo = null;
  activeTab = { id: "tab-1", type: "local" };
  configStore.set({ keybindings: {} });
  sshHistoryFile.content = "[]";
  setSshHistory([]);
  document.querySelector(".pal-overlay")?.remove();
});

describe("command palette — root", () => {
  it("opens with the > prefix and lists commands with default keybindings", async () => {
    openCommandPalette();
    await vi.waitFor(() => expect(rowTexts().length).toBeGreaterThan(0));
    expect(paletteOpen()).toBe(true);
    // Draft: fixed chrome ">" — not part of the input value.
    expect(input().value).toBe("");
    expect(document.querySelector(".pal-prefix.on")?.textContent).toBe(">");
    expect(document.querySelector(".pal-group")?.textContent).toBe("Tab");
    expect(document.querySelector(".pal-footer.on")).toBeNull();
    // New SSH Temporary Tab is a root Tab command.
    expect(rowTexts().some((t) => t.includes("New SSH Temporary Tab"))).toBe(true);
  });

  it("New Local Tab carries Ctrl+T; New SSH / Serial are palette entries", async () => {
    openCommandPalette();
    await vi.waitFor(() => expect(rowTexts().length).toBeGreaterThan(0));
    expect(rowFullTexts().some((t) => t.includes("New Local Tab") && t.includes("Ctrl+T"))).toBe(
      true,
    );
    expect(rowTexts()).toContain("New SSH Tab");
    expect(rowTexts()).toContain("New Serial Tab");
    expect(rowTexts()).toContain("Share with AI");
    expect(rowTexts()).not.toContain("SSH: Port Forwarding…");
    expect(rowTexts().some((t) => t.startsWith("Serial:"))).toBe(false);
    expect(rowTexts().some((t) => t === "Stop Sharing")).toBe(false);
    expect(rowTexts().some((t) => t === "New Tab…")).toBe(false);
    expect(rowTexts().some((t) => t.includes("Add Local"))).toBe(false);
    expect(rowTexts().some((t) => t.includes("Remove All"))).toBe(false);
  });

  it("filters by title and runs the selected command with Enter", async () => {
    openCommandPalette();
    await vi.waitFor(() => expect(rowTexts().length).toBeGreaterThan(0));
    type("terminal: clear");
    await vi.waitFor(() => expect(rowTexts()).toEqual(["Terminal: Clear"]));
    key("Enter");
    expect(fired).toEqual(["workbench.action.terminal.clear"]);
    expect(paletteOpen()).toBe(false);
  });

  it("lists SSH Port Forwarding only on an embedded-SSH tab", async () => {
    activeTab = { id: "tab-ssh", type: "ssh", sshEmbedded: true };
    openCommandPalette();
    await vi.waitFor(() => expect(rowTexts()).toContain("SSH: Port Forwarding…"));
    expect(rowTexts()).toContain("SSH: Toggle Auto-reconnect");
    expect(rowTexts().some((t) => t.startsWith("Serial:"))).toBe(false);
  });

  it("lists serial commands only on a serial tab", async () => {
    activeTab = { id: "tab-ser", type: "serial" };
    openCommandPalette();
    await vi.waitFor(() => expect(rowTexts()).toContain("Serial: Set Baud Rate…"));
    expect(rowTexts()).not.toContain("SSH: Port Forwarding…");
  });

  it("hides Port Forwarding on system ssh", async () => {
    activeTab = { id: "tab-bin", type: "ssh", sshEmbedded: false };
    openCommandPalette();
    await vi.waitFor(() => expect(rowTexts()).toContain("SSH: Toggle Auto-reconnect"));
    expect(rowTexts()).not.toContain("SSH: Port Forwarding…");
  });

  it("lists Stop Sharing only while the tab is shared", async () => {
    activeTab = { id: "tab-1", type: "local", shared: true };
    openCommandPalette();
    await vi.waitFor(() => expect(rowTexts()).toContain("Stop Sharing"));
    expect(rowTexts()).not.toContain("Share with AI");
  });

  it("serial setter refuses a non-serial active tab with an explanation", async () => {
    openPaletteFlow("serialBaud"); // active tab is local
    await vi.waitFor(() => expect(rowTexts()).toContain("115200"));
    type("115200");
    await vi.waitFor(() => expect(rowTexts()).toEqual(["115200"]));
    key("Enter");
    expect(serialCalls).toEqual([]);
    expect(document.querySelector("#toast-container")?.textContent).toContain("not a serial");
  });

  it("Escape closes at the root; Backspace on empty flips back to quick open", async () => {
    openCommandPalette();
    await vi.waitFor(() => expect(rowTexts().length).toBeGreaterThan(0));
    key("Backspace");
    expect(flippedTo).toBe("");
    expect(paletteOpen()).toBe(false);
  });
});

describe("command palette — two-level flows", () => {
  it("New SSH Temporary Tab → host opens tab (password in terminal)", async () => {
    openPaletteFlow("tempSsh");
    await vi.waitFor(() => expect(input().placeholder).toContain("connection history"));
    // Empty host step: Examples (and Recent when present).
    expect(rowTexts().some((t) => t.includes("Examples:"))).toBe(true);
    type("deploy@10.0.0.8:2222");
    await vi.waitFor(() => expect(rowTexts()[0]).toContain("Connect → deploy@10.0.0.8:2222"));
    key("Enter");

    // No palette password step — tab opens immediately, password stays for terminal.
    expect(sshTabs).toHaveLength(1);
    expect(sshTabs[0].host).toEqual({
      name: "10.0.0.8",
      hostname: "10.0.0.8",
      user: "deploy",
      port: "2222",
    });
    expect(sshTabs[0].password).toBeUndefined();
    expect(paletteOpen()).toBe(false);
    await vi.waitFor(() => expect(sshHistoryFile.content).toContain("10.0.0.8"));
  });

  it("New SSH Tab lists saved hosts only (Temporary is a separate Tab command)", async () => {
    openPaletteFlow("newSsh");
    await vi.waitFor(() => expect(rowTexts()).toContain("pi"));
    expect(rowTexts().some((t) => t.includes("Temporary"))).toBe(false);
  });

  it("New SSH Temporary Tab shows Recent and reconnects without a password page", async () => {
    setSshHistory([{ hostname: "lab", user: "pi", lastUsed: Date.now() }]);
    openPaletteFlow("tempSsh");
    await vi.waitFor(() => expect(rowTexts()).toContain("pi@lab"));
    expect(document.querySelector(".pal-group")?.textContent).toBe("Recent");
    expect(rowTexts().some((t) => t.includes("Examples:"))).toBe(true);

    const recent = [...document.querySelectorAll<HTMLElement>(".pal-row")].find((r) =>
      r.textContent?.includes("pi@lab"),
    )!;
    recent.click();
    expect(sshTabs).toHaveLength(1);
    expect(sshTabs[0].host).toEqual({ name: "lab", hostname: "lab", user: "pi" });
    expect(sshTabs[0].password).toBeUndefined();
    expect(paletteOpen()).toBe(false);
  });

  it("New SSH Temporary Tab filters Recent while typing a new host", async () => {
    setSshHistory([
      { hostname: "lab", user: "pi", lastUsed: 2 },
      { hostname: "other.example", user: "root", port: "2222", lastUsed: 1 },
    ]);
    openPaletteFlow("tempSsh");
    await vi.waitFor(() => expect(rowTexts()).toContain("pi@lab"));
    type("lab");
    // Connect → first (with default :22); matching Recent below; no Examples.
    await vi.waitFor(() => {
      expect(rowTexts()[0]).toContain("Connect → lab:22");
      expect(rowTexts()).toContain("pi@lab");
      expect(rowTexts().some((t) => t.includes("other.example"))).toBe(false);
      expect(rowTexts().some((t) => t.includes("Examples:"))).toBe(false);
    });
  });

  it("New SSH Temporary Tab completes Recent into the input without connecting", async () => {
    setSshHistory([{ hostname: "lab", user: "root", port: "2222", lastUsed: 1 }]);
    openPaletteFlow("tempSsh");
    await vi.waitFor(() => expect(rowTexts()).toContain("root@lab:2222"));
    expect(
      [...document.querySelectorAll(".pal-footer.on .pal-foot-item")].map((n) => n.textContent),
    ).toEqual(["↑↓Select", "↵Connect", "⇥Complete"]);
    expect(
      [...document.querySelectorAll(".pal-footer .pal-foot-key")].map((n) => n.textContent),
    ).toEqual(["↑↓", "↵", "⇥"]);
    expect(
      [...document.querySelectorAll(".pal-footer .pal-foot-label")].map((n) => n.textContent),
    ).toEqual(["Select", "Connect", "Complete"]);
    key("ArrowDown"); // Examples → first Recent
    key("Tab");
    expect(paletteOpen()).toBe(true);
    expect(sshTabs).toHaveLength(0);
    expect(input().value).toBe("root@lab:2222");
    await vi.waitFor(() => expect(rowTexts()[0]).toContain("Connect → root@lab:2222"));
  });

  it("Escape pops one level instead of closing", async () => {
    openPaletteFlow("newLocal");
    await vi.waitFor(() => expect(rowTexts()).toContain("PowerShell"));
    key("Escape"); // back at the command root: still open
    await vi.waitFor(() =>
      expect(rowTexts().some((t) => t.includes("New SSH Temporary Tab"))).toBe(true),
    );
    key("Escape"); // root: closes
    expect(paletteOpen()).toBe(false);
  });

  it("Serial flow applies to the active serial tab only", async () => {
    activeTab = { id: "tab-9", type: "serial" };
    openPaletteFlow("serialBaud");
    await vi.waitFor(() => expect(rowTexts()).toContain("115200"));
    type("115200");
    await vi.waitFor(() => expect(rowTexts()).toEqual(["115200"]));
    key("Enter");
    expect(serialCalls).toEqual(["baud:tab-9:115200"]);
  });
});

describe("command palette — port forwards", () => {
  const SAMPLE = [
    {
      forwardId: 7,
      kind: "local",
      listenHost: "127.0.0.1",
      listenPort: 8080,
      targetHost: "db.internal",
      targetPort: 5432,
    },
    {
      forwardId: 9,
      kind: "dynamic",
      listenHost: "127.0.0.1",
      listenPort: 1080,
      targetHost: "",
      targetPort: 0,
    },
  ];

  let live = SAMPLE.map((f) => ({ ...f }));

  beforeEach(() => {
    activeTab = { id: "tab-3", type: "ssh", sshEmbedded: true };
    live = SAMPLE.map((f) => ({ ...f }));
    invokeMock.mockClear();
    invokeMock.mockImplementation((cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "ssh_forward_list") return Promise.resolve(live);
      if (cmd === "ssh_forward_add") {
        live = [
          {
            forwardId: 12,
            kind: String(args?.kind ?? "local"),
            listenHost: String(args?.listenHost ?? ""),
            listenPort: Number(args?.listenPort ?? 0),
            targetHost: String(args?.targetHost ?? ""),
            targetPort: Number(args?.targetPort ?? 0),
          },
          ...live,
        ];
        return Promise.resolve(12);
      }
      if (cmd === "ssh_forward_remove") {
        live = live.filter((f) => f.forwardId !== args?.forwardId);
        return Promise.resolve(null);
      }
      return Promise.resolve(null);
    });
  });

  it("lists existing forwards with the one-line spec footer", async () => {
    openPaletteFlow("forwards");
    await vi.waitFor(() => expect(rowTexts().some((t) => t.includes("8080"))).toBe(true));
    expect(input().placeholder).toContain("L|R|D");
    expect(rowTexts()[0]).toContain("Examples:");
    expect(rowTexts()).toContain("Remove all forwards (2)");
    expect(rowTexts().some((t) => t.includes("Add Local"))).toBe(false);
    expect(
      [...document.querySelectorAll(".pal-footer.on .pal-foot-label")].map((n) => n.textContent),
    ).toEqual(["Select", "Add", "Complete", "Remove"]);
    expect(rowFullTexts().some((t) => t.includes("SOCKS5"))).toBe(true);

    const row = [...document.querySelectorAll<HTMLElement>(".pal-row")].find((r) =>
      r.textContent?.includes("db.internal"),
    )!;
    row.click();
    await vi.waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("ssh_forward_remove", {
        id: "tab-3",
        forwardId: 7,
      }),
    );
  });

  it("Delete removes the selected existing forward when the input is empty", async () => {
    openPaletteFlow("forwards");
    await vi.waitFor(() => expect(rowTexts().some((t) => t.includes("db.internal"))).toBe(true));
    const idx = rowTexts().findIndex((t) => t.includes("db.internal"));
    for (let i = 0; i < idx; i++) key("ArrowDown");
    key("Delete");
    await vi.waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("ssh_forward_remove", {
        id: "tab-3",
        forwardId: 7,
      }),
    );
  });

  it("adds a local forward from the one-line spec and stays open", async () => {
    openPaletteFlow("forwards");
    await vi.waitFor(() => expect(rowTexts()[0]).toContain("Examples:"));
    type("L 9000:localhost:3000");
    await vi.waitFor(() => expect(rowTexts()[0]).toContain("Add →"));
    key("Enter");
    await vi.waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("ssh_forward_add", {
        id: "tab-3",
        kind: "local",
        listenHost: "127.0.0.1",
        listenPort: 9000,
        targetHost: "localhost",
        targetPort: 3000,
      }),
    );
    expect(paletteOpen()).toBe(true);
    await vi.waitFor(() => expect(input().value).toBe(""));
  });

  it("keyboard Add Dynamic seeds D and submits the listen port", async () => {
    openPaletteFlow("forwardDynamic");
    await vi.waitFor(() => expect(input().value).toBe("D "));
    type("D 1081");
    await vi.waitFor(() => expect(rowTexts()[0]).toContain("Add →"));
    key("Enter");
    await vi.waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("ssh_forward_add", {
        id: "tab-3",
        kind: "dynamic",
        listenHost: "127.0.0.1",
        listenPort: 1081,
        targetHost: "",
        targetPort: 0,
      }),
    );
    expect(paletteOpen()).toBe(true);
  });

  it("refuses a non-embedded tab with an explanation", () => {
    activeTab = { id: "tab-1", type: "local" };
    openPaletteFlow("forwards");
    expect(paletteOpen()).toBe(false);
    expect(document.querySelector("#toast-container")?.textContent).toContain("embedded-SSH");
  });

  it("rejects an incomplete spec without leaving the page", async () => {
    openPaletteFlow("forwards");
    await vi.waitFor(() => expect(rowTexts()[0]).toContain("Examples:"));
    type("99999");
    key("Enter");
    expect(invokeMock).not.toHaveBeenCalledWith("ssh_forward_add", expect.anything());
    expect(paletteOpen()).toBe(true);
    expect(document.querySelector("#toast-container")?.textContent).toContain("L|R|D");
  });

  it("Tab completes an existing forward into the input", async () => {
    openPaletteFlow("forwards");
    await vi.waitFor(() => expect(rowTexts().some((t) => t.includes("db.internal"))).toBe(true));
    const idx = rowTexts().findIndex((t) => t.includes("db.internal"));
    for (let i = 0; i < idx; i++) key("ArrowDown");
    key("Tab");
    expect(paletteOpen()).toBe(true);
    expect(input().value).toBe("L 8080:db.internal:5432");
    await vi.waitFor(() => expect(rowTexts()[0]).toContain("Add →"));
  });
});
