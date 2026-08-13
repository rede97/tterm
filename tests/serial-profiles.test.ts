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
    return Promise.resolve(null);
  }),
}));

import {
  BUILTIN_SERIAL_PROFILES,
  dedupeSerialProfileName,
  deleteSerialProfile,
  findSerialProfile,
  loadSerialProfiles,
  parseSerialProfiles,
  sanitizeSerialProfile,
  saveSerialProfile,
} from "../src/config/serial-profiles";

beforeEach(() => {
  file.content = "[]";
  return loadSerialProfiles().then(() => {});
});

describe("built-in profiles", () => {
  it("Normal is the interactive TUI mode", () => {
    const p = BUILTIN_SERIAL_PROFILES.find((p) => p.name === "Normal")!;
    expect(p).toMatchObject({
      inputMode: "normal",
      enterNewline: "cr",
      outputNewline: "keep",
      flowControl: "none",
    });
  });

  it("Log converts bare LF to CRLF (no staircase)", () => {
    expect(BUILTIN_SERIAL_PROFILES.find((p) => p.name === "Log")!.outputNewline).toBe("cr-in-lf");
  });

  it("AT edits line-by-line and sends CRLF on Enter", () => {
    const p = BUILTIN_SERIAL_PROFILES.find((p) => p.name === "AT")!;
    expect(p.inputMode).toBe("line");
    expect(p.enterNewline).toBe("crlf");
  });
});

describe("sanitizeSerialProfile", () => {
  it("falls back to Normal-mode values for unknown fields", () => {
    const p = sanitizeSerialProfile({ inputMode: "bogus", flowControl: "magic" })!;
    expect(p.inputMode).toBe("normal");
    expect(p.flowControl).toBe("none");
  });

  it("rejects non-objects", () => {
    expect(sanitizeSerialProfile("x")).toBeNull();
    expect(sanitizeSerialProfile(null)).toBeNull();
  });
});

describe("parse / dedupe / resolve", () => {
  it("skips invalid entries, keeps valid custom ones", () => {
    file.content = JSON.stringify([
      {
        name: "Rig",
        inputMode: "echo",
        enterNewline: "crlf",
        outputNewline: "keep",
        flowControl: "hardware",
      },
      { name: "", inputMode: "echo" },
      42,
    ]);
    const list = parseSerialProfiles(file.content);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: "Rig", source: "custom", flowControl: "hardware" });
  });

  it("malformed JSON yields [] instead of throwing", () => {
    expect(parseSerialProfiles("{oops")).toEqual([]);
  });

  it("dedupeSerialProfileName avoids builtin and custom collisions", async () => {
    expect(dedupeSerialProfileName("Fresh")).toBe("Fresh");
    expect(dedupeSerialProfileName("AT")).toBe("AT 2");
    await saveSerialProfile({
      name: "AT 2",
      inputMode: "echo",
      enterNewline: "crlf",
      outputNewline: "keep",
      flowControl: "none",
    });
    expect(dedupeSerialProfileName("AT")).toBe("AT 3");
  });

  it("findSerialProfile falls back to Normal for unknown names", () => {
    expect(findSerialProfile("nope").name).toBe("Normal");
    expect(findSerialProfile(null).name).toBe("Normal");
  });
});

describe("save / delete", () => {
  it("saves, renames, and deletes custom profiles with persistence", async () => {
    await saveSerialProfile({
      name: "Mine",
      inputMode: "line",
      enterNewline: "lf",
      outputNewline: "strip",
      flowControl: "software",
    });
    expect(findSerialProfile("Mine").inputMode).toBe("line");
    expect(JSON.parse(file.content)).toHaveLength(1);

    // rename
    await saveSerialProfile(
      {
        name: "Yours",
        inputMode: "normal",
        enterNewline: "cr",
        outputNewline: "keep",
        flowControl: "none",
      },
      "Mine",
    );
    expect(findSerialProfile("Yours").name).toBe("Yours");
    expect(JSON.parse(file.content)).toHaveLength(1);

    await deleteSerialProfile("Yours");
    expect(findSerialProfile("Yours").name).toBe("Normal"); // fell back
    expect(JSON.parse(file.content)).toHaveLength(0);
  });
});
