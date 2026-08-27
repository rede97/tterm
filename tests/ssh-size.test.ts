// After pending-SSH rebind, xterm may already match the pane so fit() is a
// no-op and onResize never fires for tab-N. syncBackendSize must still push
// the live grid (htop and other TUIs read the PTY size, not the xterm view).
import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn(() => Promise.resolve(null)) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }));

import { configStore } from "../src/core/store";
import { TerminalTab } from "../src/terminal/tab";

function makeTab(id = "pending-ssh-1"): TerminalTab {
  const container = document.createElement("div");
  document.body.appendChild(container);
  return new TerminalTab(id, "ssh", "probe", container);
}

beforeEach(() => {
  configStore.set({ renderer: "dom" });
  document.body.innerHTML = "";
  invokeMock.mockClear();
});

describe("TerminalTab.syncBackendSize", () => {
  it("invokes pty_resize with the current id and grid even when fit is a no-op", () => {
    const tab = makeTab();
    invokeMock.mockClear();
    const { cols, rows } = tab.fit();
    expect(cols).toBe(tab.terminal.cols);
    expect(rows).toBe(tab.terminal.rows);
    // Same grid → xterm does not fire onResize. The pending-tab rebind path
    // still has to tell the real session.
    tab.id = "tab-9";
    tab.syncBackendSize();
    expect(invokeMock).toHaveBeenCalledWith("pty_resize", {
      id: "tab-9",
      cols: tab.terminal.cols,
      rows: tab.terminal.rows,
    });
  });
});
