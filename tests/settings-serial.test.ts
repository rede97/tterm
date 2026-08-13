import { beforeEach, describe, expect, it, vi } from "vitest";

// Fake serial-profiles.json backing store.
const { file } = vi.hoisted(() => ({ file: { content: "[]" } }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((cmd: string, args?: { name?: string; content?: string }) => {
    if (cmd === "read_config_file" && args?.name === "serial-profiles")
      return Promise.resolve(file.content);
    if (cmd === "write_config_file" && args?.name === "serial-profiles") {
      file.content = args?.content ?? "[]";
      return Promise.resolve(null);
    }
    if (cmd === "read_config_file") return Promise.resolve("{}");
    return Promise.resolve(null);
  }),
}));

import { setCustomSerialProfiles } from "../src/config/serial-profiles";
import { configStore } from "../src/core/store";
import {
  collectSerialSettings,
  createSerialPanel,
  refreshSerialPanel,
} from "../src/settings/serial";

function openPanel(): HTMLElement {
  const panel = createSerialPanel();
  document.body.appendChild(panel);
  return panel;
}

function card(panel: HTMLElement, name: string): HTMLElement {
  const el = panel.querySelector<HTMLElement>(`.sp-card[data-profile="${name}"]`);
  expect(el, `profile card "${name}"`).toBeTruthy();
  return el!;
}

beforeEach(() => {
  document.body.innerHTML = "";
  file.content = "[]";
  setCustomSerialProfiles([]);
  configStore.set({ serialBaud: 115200, serialProfile: "Normal" });
});

describe("settings — Serial panel defaults", () => {
  it("default baud select reflects config and is collected on Apply", () => {
    const panel = openPanel();
    const sel = panel.querySelector<HTMLSelectElement>("#set-serial-baud")!;
    expect(sel.value).toBe("115200");

    sel.value = "57600";
    expect(collectSerialSettings(panel).serialBaud).toBe(57600);
  });

  it("default profile select lists built-in profiles and is collected on Apply", () => {
    const panel = openPanel();
    const sel = panel.querySelector<HTMLSelectElement>("#set-serial-profile")!;
    const options = [...sel.querySelectorAll("option")].map((o) => o.value);
    expect(options).toEqual(expect.arrayContaining(["Normal", "Log", "AT"]));
    // Built-in profiles live in their own optgroup
    const builtin = sel.querySelector('optgroup[label="Built-in"]')!;
    expect([...builtin.querySelectorAll("option")].map((o) => o.value)).toEqual([
      "Normal",
      "Log",
      "AT",
    ]);
    expect(sel.value).toBe("Normal");

    sel.value = "AT";
    expect(collectSerialSettings(panel).serialProfile).toBe("AT");
  });

  it("refreshSerialPanel restores selects from config", () => {
    const panel = openPanel();
    const baud = panel.querySelector<HTMLSelectElement>("#set-serial-baud")!;
    const profile = panel.querySelector<HTMLSelectElement>("#set-serial-profile")!;
    baud.value = "9600";
    profile.value = "Log";
    refreshSerialPanel(panel);
    expect(baud.value).toBe("115200");
    expect(profile.value).toBe("Normal");
  });
});

describe("settings — Serial profile gallery", () => {
  it("shows the Built-in section with Normal/Log/AT and their summaries", () => {
    const panel = openPanel();
    const headers = [...panel.querySelectorAll(".theme-group-title")].map((h) => h.textContent);
    expect(headers).toEqual(["Built-in", "Custom"]);

    expect(card(panel, "Normal").querySelector(".sp-card-summary")!.textContent).toBe(
      "normal · Enter→CR · out keep · flow none",
    );
    expect(card(panel, "Log").querySelector(".sp-card-summary")!.textContent).toBe(
      "normal · Enter→CR · out cr-in-lf · flow none",
    );
    expect(card(panel, "AT").querySelector(".sp-card-summary")!.textContent).toBe(
      "echo · Enter→CRLF · out keep · flow none",
    );

    // Every card has Duplicate; built-ins have no Edit.
    for (const name of ["Normal", "Log", "AT"]) {
      const actions = [...card(panel, name).querySelectorAll(".theme-card-action")].map(
        (b) => b.textContent,
      );
      expect(actions).toEqual(["Duplicate"]);
    }
    // The custom grid always offers the New Profile affordance.
    expect(panel.querySelector("#set-serial-profile-new")!.textContent).toBe("+ New Profile");
  });

  it("Duplicate on AT opens the editor prefilled as a copy", () => {
    const panel = openPanel();
    card(panel, "AT").querySelector<HTMLButtonElement>(".theme-card-action")!.click();

    const overlay = document.body.querySelector(".sp-overlay");
    expect(overlay, "profile editor modal").toBeTruthy();
    expect(overlay!.querySelector<HTMLInputElement>(".sp-name")!.value).toBe("AT Copy");
    expect(
      overlay!.querySelector<HTMLSelectElement>('.sp-select[data-field="inputMode"]')!.value,
    ).toBe("echo");
    expect(
      overlay!.querySelector<HTMLSelectElement>('.sp-select[data-field="enterNewline"]')!.value,
    ).toBe("crlf");
    // No summary preview in the editor (removed by design).
    expect(overlay!.querySelector(".sp-preview")).toBeNull();
  });

  it("Output newlines select shows a live help line and per-option tooltips", () => {
    const panel = openPanel();
    card(panel, "AT").querySelector<HTMLButtonElement>(".theme-card-action")!.click();
    const overlay = document.body.querySelector(".sp-overlay")!;

    const sel = overlay.querySelector<HTMLSelectElement>('.sp-select[data-field="outputNewline"]')!;
    const hint = overlay.querySelector<HTMLElement>(".sp-hint")!;
    // AT profile is out=keep: hint explains the current selection.
    expect(sel.value).toBe("keep");
    expect(hint.textContent).toContain("Pass through unchanged");
    // Every option carries its description as a hover tooltip.
    for (const opt of sel.querySelectorAll("option")) {
      expect(opt.title.length).toBeGreaterThan(0);
    }
    // Switching the select updates the hint to the new mode's description.
    sel.value = "cr-in-lf";
    sel.dispatchEvent(new Event("change"));
    expect(hint.textContent).toBe("Lone \\n → \\r\\n");
    sel.value = "strip";
    sel.dispatchEvent(new Event("change"));
    expect(hint.textContent).toBe("\\r | \\n → (removed)");
  });

  it("saving a custom profile adds it to the Custom section with an Edit button", async () => {
    const panel = openPanel();
    card(panel, "AT").querySelector<HTMLButtonElement>(".theme-card-action")!.click();
    const overlay = document.body.querySelector(".sp-overlay")!;
    overlay.querySelector<HTMLButtonElement>(".sp-save")!.click();

    await vi.waitFor(() => {
      expect(panel.querySelector('.sp-card[data-profile="AT Copy"]')).toBeTruthy();
    });
    // Modal closed, persisted to serial-profiles.json, custom card has Edit.
    expect(document.body.querySelector(".sp-overlay")).toBeNull();
    expect(JSON.parse(file.content)).toEqual([
      {
        name: "AT Copy",
        inputMode: "echo",
        enterNewline: "crlf",
        outputNewline: "keep",
        flowControl: "none",
      },
    ]);
    const actions = [...card(panel, "AT Copy").querySelectorAll(".theme-card-action")].map(
      (b) => b.textContent,
    );
    expect(actions).toEqual(["Duplicate", "Edit"]);
    // The new profile is also selectable as the default.
    const sel = panel.querySelector<HTMLSelectElement>("#set-serial-profile")!;
    expect([...sel.querySelectorAll("option")].map((o) => o.value)).toContain("AT Copy");
  });

  it("rejects a name that collides with an existing profile", async () => {
    const panel = openPanel();
    card(panel, "AT").querySelector<HTMLButtonElement>(".theme-card-action")!.click();
    const overlay = document.body.querySelector(".sp-overlay")!;
    overlay.querySelector<HTMLInputElement>(".sp-name")!.value = "Normal";
    overlay.querySelector<HTMLButtonElement>(".sp-save")!.click();

    // Save refused: modal stays open, nothing persisted.
    await Promise.resolve();
    expect(document.body.querySelector(".sp-overlay")).toBeTruthy();
    expect(JSON.parse(file.content)).toEqual([]);
  });

  it("deleting the in-use default profile resets serialProfile to Normal", async () => {
    // Seed a custom profile and make it the global default.
    const panel = openPanel();
    card(panel, "AT").querySelector<HTMLButtonElement>(".theme-card-action")!.click();
    document.body.querySelector<HTMLButtonElement>(".sp-overlay .sp-save")!.click();
    await vi.waitFor(() => {
      expect(panel.querySelector('.sp-card[data-profile="AT Copy"]')).toBeTruthy();
    });
    configStore.set({ serialProfile: "AT Copy" });
    refreshSerialPanel(panel);
    expect(panel.querySelector<HTMLSelectElement>("#set-serial-profile")!.value).toBe("AT Copy");

    vi.stubGlobal(
      "confirm",
      vi.fn(() => true),
    );
    try {
      const actions = [
        ...card(panel, "AT Copy").querySelectorAll<HTMLButtonElement>(".theme-card-action"),
      ];
      actions.find((b) => b.textContent === "Edit")!.click();
      const overlay = document.body.querySelector(".sp-overlay")!;
      expect(overlay.querySelector<HTMLInputElement>(".sp-name")!.value).toBe("AT Copy");
      overlay.querySelector<HTMLButtonElement>(".sp-delete")!.click();
      // Delete now goes through confirmDialog — approve it.
      await vi.waitFor(() => {
        expect(document.body.querySelector(".confirm-overlay")).toBeTruthy();
      });
      document.body
        .querySelector<HTMLButtonElement>(
          ".confirm-overlay .sshauth-footer .sshauth-btn:last-child",
        )!
        .click();

      await vi.waitFor(() => {
        expect(configStore.get("serialProfile")).toBe("Normal");
      });
      expect(panel.querySelector('.sp-card[data-profile="AT Copy"]')).toBeNull();
      expect(panel.querySelector<HTMLSelectElement>("#set-serial-profile")!.value).toBe("Normal");
      expect(JSON.parse(file.content)).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
