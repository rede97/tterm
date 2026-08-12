import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.resolve(null)) }));

import { configStore } from "../src/core/store";
import { pasteIntoTerminal } from "../src/terminal/paste";

function target() {
  return {
    pasted: [] as string[],
    paste(text: string) {
      this.pasted.push(text);
    },
  };
}

async function flushMicrotasks(): Promise<void> {
  // confirmDialog resolves through Promise.withResolvers + modal close.
  await Promise.resolve();
  await Promise.resolve();
}

describe("pasteIntoTerminal (pasteTrim / pasteWarning)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    configStore.set({ pasteWarning: true, pasteTrim: true });
  });

  it("single-line paste goes straight through, no dialog", () => {
    const t = target();
    pasteIntoTerminal(t, "echo hello\n");
    expect(t.pasted).toEqual(["echo hello"]);
    expect(document.querySelector(".confirm-overlay")).toBeNull();
  });

  it("multi-line paste warns; confirming pastes", async () => {
    const t = target();
    pasteIntoTerminal(t, "echo a\necho b");
    // Nothing pasted until the user confirms.
    expect(t.pasted).toEqual([]);
    const overlay = document.querySelector(".confirm-overlay");
    expect(overlay).toBeTruthy();
    expect(overlay!.textContent).toContain("2 lines");
    overlay!.querySelector<HTMLButtonElement>(".sshauth-footer .sshauth-btn:last-child")!.click();
    await flushMicrotasks();
    expect(t.pasted).toEqual(["echo a\necho b"]);
  });

  it("multi-line paste warns; cancelling pastes nothing", async () => {
    const t = target();
    pasteIntoTerminal(t, "echo a\necho b");
    document.querySelector<HTMLButtonElement>(".sshauth-btn-cancel")!.click();
    await flushMicrotasks();
    expect(t.pasted).toEqual([]);
  });

  it("pasteWarning off: multi-line pastes without a dialog", () => {
    configStore.set({ pasteWarning: false });
    const t = target();
    pasteIntoTerminal(t, "echo a\necho b");
    expect(t.pasted).toEqual(["echo a\necho b"]);
    expect(document.querySelector(".confirm-overlay")).toBeNull();
  });

  it("pasteTrim off keeps trailing newline, single command still skips the warning", () => {
    configStore.set({ pasteTrim: false });
    const t = target();
    pasteIntoTerminal(t, "echo hello\n");
    expect(t.pasted).toEqual(["echo hello\n"]);
    expect(document.querySelector(".confirm-overlay")).toBeNull();
  });
});
