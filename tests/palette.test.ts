import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.resolve(null)) }));

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
let activeTab: { id: string; type: string } | null = { id: "tab-1", type: "local" };

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
  showPortForwards: vi.fn(),
  flipToQuickOpen: (q) => {
    flippedTo = q;
  },
};
setPaletteHandlers(handlers);

function input(): HTMLInputElement {
  return document.querySelector<HTMLInputElement>(".pal-panel .tab-switcher-input")!;
}
function rowTexts(): string[] {
  return [...document.querySelectorAll<HTMLElement>(".pal-row .tab-switcher-label")].map(
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
  document.querySelector(".tab-switcher-overlay")?.remove();
});

describe("command palette — root", () => {
  it("opens with the > prefix and lists commands with default keybindings", async () => {
    openCommandPalette();
    await vi.waitFor(() => expect(rowTexts().length).toBeGreaterThan(0));
    expect(paletteOpen()).toBe(true);
    expect(input().value).toBe(">");
    // kbd chip shows the effective default combo.
    expect(rowFullTexts().some((t) => t.includes("Ctrl+Shift+P"))).toBe(true);
    // Palette-only commands are listed even with no binding.
    expect(rowTexts().some((t) => t.includes("Temporary Connect"))).toBe(true);
  });

  it("filters by title and runs the selected command with Enter", async () => {
    openCommandPalette();
    await vi.waitFor(() => expect(rowTexts().length).toBeGreaterThan(0));
    type(">baud");
    await vi.waitFor(() => expect(rowTexts()).toEqual(["Baud Rate…"]));
    key("Enter");
    // The command dispatches through the keymap handler table and closes.
    expect(fired).toEqual(["tterm.serialBaud"]);
    expect(paletteOpen()).toBe(false);
  });

  it("serial setter refuses a non-serial active tab with an explanation", async () => {
    openPaletteFlow("serialBaud"); // active tab is local
    await vi.waitFor(() => expect(rowTexts()).toContain("115200"));
    type(">115200");
    await vi.waitFor(() => expect(rowTexts()).toEqual(["115200"]));
    key("Enter");
    expect(serialCalls).toEqual([]);
    expect(document.querySelector("#toast-container")?.textContent).toContain("not a serial");
  });

  it("Escape closes at the root; deleting > flips back to quick open", async () => {
    openCommandPalette();
    await vi.waitFor(() => expect(rowTexts().length).toBeGreaterThan(0));
    type("pi"); // no leading >
    expect(flippedTo).toBe("pi");
    expect(paletteOpen()).toBe(false);
  });
});

describe("command palette — two-level flows", () => {
  it("New Tab… → SSH → Temporary Connect → host → password", async () => {
    openPaletteFlow("newTab");
    await vi.waitFor(() => expect(rowTexts()).toEqual(["Local", "SSH", "Serial"]));

    key("ArrowDown");
    key("Enter"); // SSH
    await vi.waitFor(() => expect(rowTexts()[0]).toContain("Temporary Connect"));
    expect(rowTexts()).toContain("pi");

    key("Enter"); // Temporary Connect…
    await vi.waitFor(() => expect(input().placeholder).toContain("user@host"));
    type("deploy@10.0.0.8:2222"); // text pages take free-form input, no ">"
    key("Enter");

    // Password page masks input.
    await vi.waitFor(() => expect(input().type).toBe("password"));
    type("s3cret");
    key("Enter");

    expect(sshTabs).toHaveLength(1);
    expect(sshTabs[0].host).toEqual({
      name: "10.0.0.8",
      hostname: "10.0.0.8",
      user: "deploy",
      port: "2222",
    });
    expect(sshTabs[0].password).toBe("s3cret");
    expect(paletteOpen()).toBe(false);
  });

  it("Escape pops one level instead of closing", async () => {
    openPaletteFlow("newTab");
    await vi.waitFor(() => expect(rowTexts()).toEqual(["Local", "SSH", "Serial"]));
    key("Enter"); // Local level
    await vi.waitFor(() => expect(rowTexts()).toContain("PowerShell"));
    key("Escape");
    await vi.waitFor(() => expect(rowTexts()).toEqual(["Local", "SSH", "Serial"]));
    expect(paletteOpen()).toBe(true);
    key("Escape"); // back at the command root: still open
    await vi.waitFor(() =>
      expect(rowTexts().some((t) => t.includes("Temporary Connect"))).toBe(true),
    );
    key("Escape"); // root: closes
    expect(paletteOpen()).toBe(false);
  });

  it("Serial flow applies to the active serial tab only", async () => {
    activeTab = { id: "tab-9", type: "serial" };
    openPaletteFlow("serialBaud");
    await vi.waitFor(() => expect(rowTexts()).toContain("115200"));
    type(">115200");
    await vi.waitFor(() => expect(rowTexts()).toEqual(["115200"]));
    key("Enter");
    expect(serialCalls).toEqual(["baud:tab-9:115200"]);
  });
});
