import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(() => Promise.resolve()) }));

import { openUrl } from "@tauri-apps/plugin-opener";
import type { Terminal } from "@xterm/xterm";
import { handleWebLink, openExternalLink, setupTerminalLinks } from "../src/terminal/links";

const openUrlMock = vi.mocked(openUrl);

describe("terminal links", () => {
  beforeEach(() => vi.clearAllMocks());

  it("auto-detected URLs open on Ctrl+click", () => {
    handleWebLink(new MouseEvent("mouseup", { ctrlKey: true }), "https://example.com");
    expect(openUrlMock).toHaveBeenCalledWith("https://example.com");
  });

  it("auto-detected URLs open on Cmd+click (macOS)", () => {
    handleWebLink(new MouseEvent("mouseup", { metaKey: true }), "https://example.com");
    expect(openUrlMock).toHaveBeenCalledWith("https://example.com");
  });

  it("plain click on an auto-detected URL does nothing (stays selectable)", () => {
    handleWebLink(new MouseEvent("mouseup"), "https://example.com");
    expect(openUrlMock).not.toHaveBeenCalled();
  });

  it("OSC 8 hyperlinks open on plain click via linkHandler", () => {
    const addon = vi.fn();
    const terminal = { options: {}, loadAddon: addon } as unknown as Terminal;
    setupTerminalLinks(terminal);

    expect(addon).toHaveBeenCalledOnce();
    const handler = terminal.options.linkHandler;
    expect(handler).toBeTruthy();
    handler!.activate(new MouseEvent("mouseup"), "https://example.com", undefined as never);
    expect(openUrlMock).toHaveBeenCalledWith("https://example.com");
  });

  it("openExternalLink swallows opener failures without throwing", async () => {
    openUrlMock.mockRejectedValueOnce(new Error("no browser"));
    openExternalLink("https://example.com");
    await vi.waitFor(() => {
      expect(document.querySelector(".toast-error")?.textContent).toContain("https://example.com");
    });
  });
});
