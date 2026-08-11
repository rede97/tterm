import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.resolve(null)) }));

import { invoke } from "@tauri-apps/api/core";
import { showPortForwardingDialog } from "../src/terminal/forwarding";

const mockInvoke = vi.mocked(invoke);

const SAMPLE_FORWARDS = [
  { forwardId: 7, kind: "local", listenHost: "127.0.0.1", listenPort: 8080, targetHost: "db.internal", targetPort: 5432 },
  { forwardId: 9, kind: "remote", listenHost: "0.0.0.0", listenPort: 9000, targetHost: "127.0.0.1", targetPort: 3000 },
];

// Drain pending microtask chains (dialog open/refresh are promise-only).
async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

function lastToast(): HTMLElement | null {
  const toasts = document.querySelectorAll<HTMLElement>("#toast-container .toast");
  return toasts.length ? toasts[toasts.length - 1] : null;
}

beforeEach(() => {
  mockInvoke.mockReset();
  mockInvoke.mockImplementation((cmd: unknown) => {
    if (cmd === "ssh_forward_list") return Promise.resolve([]);
    return Promise.resolve(null);
  });
  document.body.innerHTML = "";
});

describe("port forwarding dialog", () => {
  it("lists current mappings on open", async () => {
    mockInvoke.mockImplementation((cmd: unknown) => {
      if (cmd === "ssh_forward_list") return Promise.resolve(SAMPLE_FORWARDS);
      return Promise.resolve(null);
    });
    showPortForwardingDialog("tab-1");
    await flush();

    expect(mockInvoke).toHaveBeenCalledWith("ssh_forward_list", { id: "tab-1" });
    const rows = document.querySelectorAll<HTMLElement>(".fwd-row");
    expect(rows).toHaveLength(2);
    expect(rows[0].querySelector(".fwd-badge")!.textContent).toBe("Local");
    expect(rows[0].querySelector(".fwd-route")!.textContent).toBe("127.0.0.1:8080 → db.internal:5432");
    expect(rows[1].querySelector(".fwd-badge")!.textContent).toBe("Remote");
    expect(rows[1].querySelector(".fwd-route")!.textContent).toBe("0.0.0.0:9000 → 127.0.0.1:3000");
  });

  it("adds a valid local forward with parsed numbers", async () => {
    showPortForwardingDialog("tab-1");
    await flush();

    // Direction → (default): Local port = listen (host pinned to
    // 127.0.0.1), Remote host:port = target.
    const ports = document.querySelectorAll<HTMLInputElement>(".xfe-port");
    const hosts = document.querySelectorAll<HTMLInputElement>(".xfe-host");
    expect(hosts[0].disabled).toBe(true);
    expect(hosts[0].value).toBe("127.0.0.1");
    ports[0].value = "8080";
    hosts[1].value = "127.0.0.1";
    hosts[1].dispatchEvent(new Event("input"));
    ports[1].value = "3000";
    document.querySelector<HTMLButtonElement>(".fwd-add-btn")!.click();
    await flush();

    expect(mockInvoke).toHaveBeenCalledWith("ssh_forward_add", {
      id: "tab-1",
      kind: "local",
      listenHost: "127.0.0.1",
      listenPort: 8080,
      targetHost: "127.0.0.1",
      targetPort: 3000,
    });
    // list refreshed after add: initial load + refresh
    expect(mockInvoke.mock.calls.filter(c => c[0] === "ssh_forward_list")).toHaveLength(2);
  });

  it.each(["0", "70000", "abc"])("rejects invalid port %s with a toast and no invoke", async (bad) => {
    showPortForwardingDialog("tab-1");
    await flush();

    const ports = document.querySelectorAll<HTMLInputElement>(".xfe-port");
    ports[0].value = bad;
    ports[1].value = "3000";
    document.querySelector<HTMLButtonElement>(".fwd-add-btn")!.click();
    await flush();

    expect(mockInvoke).not.toHaveBeenCalledWith("ssh_forward_add", expect.anything());
    const toast = lastToast();
    expect(toast).not.toBeNull();
    expect(toast!.classList.contains("toast-error")).toBe(true);
    expect(toast!.textContent).toContain("65535");
  });

  it("removes a forward via its forwardId and refreshes", async () => {
    mockInvoke.mockImplementation((cmd: unknown) => {
      if (cmd === "ssh_forward_list") return Promise.resolve(SAMPLE_FORWARDS);
      return Promise.resolve(null);
    });
    showPortForwardingDialog("tab-1");
    await flush();

    const removeBtns = document.querySelectorAll<HTMLButtonElement>(".fwd-remove");
    expect(removeBtns).toHaveLength(2);
    removeBtns[1].click();
    await flush();

    expect(mockInvoke).toHaveBeenCalledWith("ssh_forward_remove", { id: "tab-1", forwardId: 9 });
    // refreshed: initial load + post-remove refresh
    expect(mockInvoke.mock.calls.filter(c => c[0] === "ssh_forward_list")).toHaveLength(2);
  });

  it("shows a toast and no modal for non-embedded ssh sessions", async () => {
    mockInvoke.mockImplementation((cmd: unknown) => {
      if (cmd === "ssh_forward_list") return Promise.reject(new Error("not an embedded ssh session"));
      return Promise.resolve(null);
    });
    showPortForwardingDialog("tab-1");
    await flush();

    expect(document.querySelector(".fwd-overlay")).toBeNull();
    const toast = lastToast();
    expect(toast).not.toBeNull();
    expect(toast!.classList.contains("toast-error")).toBe(true);
    expect(toast!.textContent).toBe("Port forwarding requires the built-in SSH client");
  });

  it("dismisses via close button, Escape, and overlay click", async () => {
    for (const mode of ["button", "escape", "overlay"] as const) {
      document.body.innerHTML = "";
      showPortForwardingDialog("tab-1");
      await flush();
      const overlay = document.querySelector<HTMLElement>(".fwd-overlay")!;
      expect(overlay).not.toBeNull();

      if (mode === "button") {
        overlay.querySelector<HTMLButtonElement>(".fwd-close")!.click();
      } else if (mode === "escape") {
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      } else {
        overlay.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      }
      expect(document.querySelector(".fwd-overlay")).toBeNull();
    }
  });
});
