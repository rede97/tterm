// SettingsShell lifecycle: switching to a terminal tab must SUSPEND the
// settings page (hide, keep DOM so unsaved edits / active panel / expansion
// survive), while the X close must DISMISS it (remove, rebuild on reopen).
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/terminal/quickpanel", () => ({
  closeQuickPanel: vi.fn(),
  updateQuickButton: vi.fn(),
}));

import { SettingsShell } from "../src/terminal/settingsshell";

function makeShell() {
  const tabsContainer = document.createElement("div");
  const terminalContainer = document.createElement("div");
  document.body.appendChild(tabsContainer);
  document.body.appendChild(terminalContainer);
  const hooks = {
    hideActiveView: vi.fn(),
    restoreActiveView: vi.fn(),
    syncStrip: vi.fn(),
  };
  let factoryCalls = 0;
  const shell = new SettingsShell(tabsContainer, terminalContainer, hooks);
  shell.setFactory(async () => {
    factoryCalls++;
    const page = document.createElement("div");
    page.className = "settings-page";
    return page;
  });
  return { shell, terminalContainer, getFactoryCalls: () => factoryCalls };
}

async function open(shell: SettingsShell, container: HTMLElement): Promise<void> {
  shell.toggle();
  await vi.waitFor(() => {
    expect(container.querySelector(".settings-page")).not.toBeNull();
  });
}

describe("SettingsShell suspend vs dismiss", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("suspend hides the page and reopens it without rebuilding", async () => {
    const { shell, terminalContainer, getFactoryCalls } = makeShell();
    await open(shell, terminalContainer);
    const page = terminalContainer.querySelector(".settings-page") as HTMLElement;

    shell.close(false); // tab switch → suspend
    expect(page.style.display).toBe("none");
    expect(terminalContainer.contains(page)).toBe(true);

    shell.toggle(); // reopen → re-show the kept page (synchronous path)
    expect(getFactoryCalls()).toBe(1);
    expect(page.style.display).toBe("");
  });

  it("dismiss removes the page and reopen rebuilds it", async () => {
    const { shell, terminalContainer, getFactoryCalls } = makeShell();
    await open(shell, terminalContainer);
    const page = terminalContainer.querySelector(".settings-page") as HTMLElement;

    shell.close(true); // X close → dismiss
    expect(terminalContainer.contains(page)).toBe(false);

    await open(shell, terminalContainer); // reopen → rebuild fresh
    expect(getFactoryCalls()).toBe(2);
    expect(terminalContainer.querySelector(".settings-page")).not.toBeNull();
  });

  it("settings pseudo-tab close button carries a readable name", async () => {
    const { shell, terminalContainer } = makeShell();
    await open(shell, terminalContainer);
    const closeBtn = document.querySelector<HTMLButtonElement>(".tab-close");
    expect(closeBtn?.getAttribute("aria-label")).toBe("Close settings");
    expect(closeBtn?.title).toBe("Close settings");
  });
});
