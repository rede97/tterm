import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn((cmd: string) => {
    if (cmd === "read_config_file") return Promise.resolve("{}");
    if (cmd === "serial_list_ports") return Promise.resolve([]);
    if (cmd === "ssh_list_keys") return Promise.resolve([]);
    return Promise.resolve(null);
  }),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: () => Promise.resolve("1.0.1") }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

import { configStore } from "../src/core/store";
import { createSettingsContent } from "../src/settings/index";
import { resetSshConfigDirty } from "../src/settings/ssh";

beforeEach(() => {
  document.body.innerHTML = "";
  invokeMock.mockClear();
  resetSshConfigDirty();
  configStore.set({
    sshHosts: [{ name: "LocalMyPC", hostname: "192.168.1.7", user: "rede" }],
    hiddenSshHosts: [],
  });
});

function revertButton(root: HTMLElement): HTMLButtonElement {
  const btn = root.querySelector<HTMLButtonElement>(".settings-footer .tt-btn-ghost");
  expect(btn, "revert button").toBeTruthy();
  return btn!;
}

describe("settings — panel visibility", () => {
  it("opens on General with all other panels hidden; sidebar switches", () => {
    const root = createSettingsContent();
    document.body.appendChild(root);

    const panels = [...root.querySelectorAll<HTMLElement>(".settings-panel-content")];
    expect(panels.map((p) => p.dataset.panel)).toEqual([
      "general",
      "appearance",
      "profile",
      "ssh",
      "serial",
      "keyboard",
    ]);
    // Only General shows on open — a panel that forgets display:none
    // renders stacked over the General page.
    for (const p of panels) {
      expect(p.style.display, `${p.dataset.panel} initial visibility`).toBe(
        p.dataset.panel === "general" ? "" : "none",
      );
    }

    // Sidebar navigation flips visibility.
    root.querySelectorAll<HTMLElement>(".settings-nav-item").forEach((n) => {
      if (n.dataset.panel === "keyboard") n.click();
    });
    for (const p of panels) {
      expect(p.style.display, `${p.dataset.panel} after switching`).toBe(
        p.dataset.panel === "keyboard" ? "" : "none",
      );
    }
  });
});

describe("settings — Revert", () => {
  it("keeps the settings page intact and re-renders only the SSH panel", async () => {
    const root = createSettingsContent();
    document.body.appendChild(root);

    revertButton(root).click();
    await vi.waitFor(() => {
      expect(document.querySelector("#toast-container")?.textContent).toContain(
        "Reverted to saved settings",
      );
    });

    // Page chrome survives: sidebar with all six panels, footer buttons.
    expect(root.querySelectorAll(".settings-nav-item")).toHaveLength(6);
    expect(revertButton(root).textContent).toBe("Revert");
    const footerApply = root.querySelector<HTMLButtonElement>(".settings-footer .tt-btn-primary");
    expect(footerApply!.textContent).toBe("Apply");

    // Every panel still exists exactly once…
    for (const name of ["general", "appearance", "profile", "ssh", "serial", "keyboard"]) {
      expect(
        root.querySelectorAll(`.settings-panel-content[data-panel="${name}"]`),
        `${name} panel`,
      ).toHaveLength(1);
    }

    // …and the SSH panel re-rendered inside its own container (host list
    // reflects the reloaded store, not duplicated or orphaned markup).
    const sshPanel = root.querySelector<HTMLElement>('.settings-panel-content[data-panel="ssh"]')!;
    expect(sshPanel.textContent).toContain("Hosts from ~/.ssh/config");
    expect(sshPanel.querySelectorAll(".check-row")).toHaveLength(1);
    expect(sshPanel.textContent).toContain("LocalMyPC");
  });

  it("revert is repeatable — the page survives a second click", async () => {
    const root = createSettingsContent();
    document.body.appendChild(root);

    for (let i = 0; i < 2; i++) {
      revertButton(root).click();
      await vi.waitFor(() => {
        expect(document.querySelector("#toast-container")?.textContent).toContain(
          "Reverted to saved settings",
        );
      });
    }

    expect(root.querySelectorAll(".settings-nav-item")).toHaveLength(6);
    expect(root.querySelectorAll('.settings-panel-content[data-panel="ssh"]')).toHaveLength(1);
    expect(root.querySelectorAll(".check-row")).toHaveLength(1);
    // Regression: refreshShortcutsPanel must not render the keyboard panel
    // into the sidebar nav button (both carry data-panel="keyboard"; the
    // nav button precedes the panels in DOM order).
    const kbNav = [...root.querySelectorAll<HTMLElement>(".settings-nav-item")].find(
      (n) => n.dataset.panel === "keyboard",
    )!;
    expect(kbNav.textContent).toBe("Keyboard");
    expect(kbNav.querySelector(".kb-search")).toBeNull();
  });
});

describe("settings — footer dirty hint", () => {
  it("hidden when clean, appears in real time on a working-copy edit", () => {
    const root = createSettingsContent();
    document.body.appendChild(root);
    const hint = root.querySelector<HTMLElement>("#dirty-hint")!;
    expect(hint.classList.contains("on")).toBe(false);

    // Delete a host via the embedded ssh panel → footer hint appears,
    // without any panel switch or Apply.
    root.querySelector<HTMLButtonElement>(".ssh-btn-delete")!.click();
    expect(hint.classList.contains("on")).toBe(true);
    expect(hint.textContent).toBe("SSH config will be written on Apply");
  });

  it("reflects a dirty state left over from a previous settings visit", () => {
    // Simulate: user edited, closed settings without applying. The flag
    // survives (module state), so the next settings page opens with the
    // hint already showing.
    const first = createSettingsContent();
    document.body.appendChild(first);
    first.querySelector<HTMLButtonElement>(".ssh-btn-delete")!.click();
    first.remove();

    const reopened = createSettingsContent();
    document.body.appendChild(reopened);
    const hint = reopened.querySelector<HTMLElement>("#dirty-hint")!;
    expect(hint.classList.contains("on")).toBe(true);
    expect(hint.textContent).toContain("SSH config");
  });
});
