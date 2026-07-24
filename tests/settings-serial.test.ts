import { describe, it, expect, vi, beforeEach } from "vitest";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn((cmd: string) => {
    if (cmd === "serial_list_ports") {
      return Promise.resolve([
        { name: "COM3", driver: "usbser", manufacturer: "wch.cn", product: "USB-SERIAL CH340", vid: "1A86", pid: "7523" },
      ]);
    }
    if (cmd === "read_config") return Promise.resolve("{}");
    if (cmd === "ssh_read_config_raw") return Promise.resolve("");
    return Promise.resolve(null);
  }),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: () => Promise.resolve("0.2.0") }));

import { createSettingsContent } from "../src/settings/index";

describe("settings — Serial panel", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    invokeMock.mockClear();
  });

  async function openSerialPanel() {
    const root = createSettingsContent();
    document.body.appendChild(root);
    const nav = root.querySelector<HTMLElement>('[data-panel="serial"].settings-nav-item')!;
    expect(nav, "Serial nav item").toBeTruthy();
    nav.click();
    return root;
  }

  it("has a Serial nav item and shows the panel on click", async () => {
    const root = await openSerialPanel();
    const panel = root.querySelector<HTMLElement>('.settings-panel-content[data-panel="serial"]')!;
    expect(panel.style.display).toBe("");
    // default baud select moved here from General
    expect(panel.querySelector("#set-serial-baud")).toBeTruthy();
  });

  it("lists enumerated ports with per-port baud and input-mode selects", async () => {
    const root = await openSerialPanel();
    await vi.waitFor(() => {
      expect(root.querySelectorAll(".serial-port-row").length).toBe(1);
    });
    const row = root.querySelector(".serial-port-row")!;
    expect(row.querySelector(".settings-item-title")!.textContent).toBe("COM3");
    expect(row.querySelector(".settings-item-desc")!.textContent).toContain("1A86:7523");
    const baudSel = row.querySelector<HTMLSelectElement>(".serial-port-baud")!;
    expect(baudSel.querySelector("option[selected]")!.getAttribute("value")).toBe("115200");
    const modeSel = row.querySelector<HTMLSelectElement>(".serial-port-mode")!;
    expect(modeSel.querySelector("option[selected]")!.getAttribute("value")).toBe("normal");
  });

  it("changing a port baud persists per-port memory keyed by VID:PID", async () => {
    const root = await openSerialPanel();
    await vi.waitFor(() => {
      expect(root.querySelectorAll(".serial-port-row").length).toBe(1);
    });
    const sel = root.querySelector<HTMLSelectElement>(".serial-port-baud")!;
    sel.value = "57600";
    sel.dispatchEvent(new Event("change"));
    await vi.waitFor(() => {
      const write = invokeMock.mock.calls.find(c => c[0] === "write_config");
      expect(write).toBeTruthy();
      const written = JSON.parse((write![1] as any).content);
      expect(written.serialPortParams["usb:1A86:7523"].baud).toBe(57600);
    });
    // history section now shows the remembered record
    await vi.waitFor(() => {
      expect(root.querySelectorAll(".serial-history-row").length).toBe(1);
    });
    expect(root.querySelector(".serial-history-row")!.textContent).toContain("57600");
  });

  it("forget button removes a history record", async () => {
    const root = await openSerialPanel();
    await vi.waitFor(() => {
      expect(root.querySelectorAll(".serial-port-row").length).toBe(1);
    });
    const sel = root.querySelector<HTMLSelectElement>(".serial-port-mode")!;
    sel.value = "line";
    sel.dispatchEvent(new Event("change"));
    await vi.waitFor(() => {
      expect(root.querySelectorAll(".serial-history-row").length).toBe(1);
    });
    const btn = root.querySelector<HTMLButtonElement>(".serial-history-forget")!;
    btn.click();
    await vi.waitFor(() => {
      expect(root.querySelectorAll(".serial-history-row").length).toBe(0);
    });
    expect(root.querySelector("#serial-history-list")!.textContent).toContain("No remembered");
  });
});
