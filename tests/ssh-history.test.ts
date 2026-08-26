import { beforeEach, describe, expect, it, vi } from "vitest";

const { file } = vi.hoisted(() => ({ file: { content: "[]" } }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((cmd: string, args?: { name?: string; content?: string }) => {
    if (cmd === "read_config_file" && args?.name === "ssh-history") {
      return Promise.resolve(file.content);
    }
    if (cmd === "write_config_file" && args?.name === "ssh-history") {
      file.content = args.content ?? "[]";
      return Promise.resolve(null);
    }
    return Promise.resolve(null);
  }),
}));

import {
  entryLabel,
  entryToHost,
  historyKey,
  hostToEntry,
  listSshHistory,
  loadSshHistory,
  normPort,
  parseSshHistory,
  rememberInList,
  rememberSshHistory,
  sanitizeEntry,
  setSshHistory,
} from "../src/config/ssh-history";

beforeEach(async () => {
  file.content = "[]";
  setSshHistory([]);
  await loadSshHistory();
});

describe("ssh-history sanitize / parse", () => {
  it("normalizes default port and builds labels", () => {
    expect(normPort(undefined)).toBe("22");
    expect(normPort("22")).toBe("22");
    expect(normPort("2222")).toBe("2222");
    expect(entryLabel({ hostname: "lab", user: "pi", lastUsed: 1 })).toBe("pi@lab");
    expect(entryLabel({ hostname: "lab", user: "root", port: "2222", lastUsed: 1 })).toBe(
      "root@lab:2222",
    );
    expect(historyKey({ hostname: "lab", user: "pi" })).toBe("pi@lab:22");
    expect(historyKey({ hostname: "lab", user: "pi", port: "22" })).toBe("pi@lab:22");
  });

  it("drops invalid entries and dedupes by key keeping newest", () => {
    const parsed = parseSshHistory(
      JSON.stringify([
        { hostname: "a", user: "u", lastUsed: 1 },
        { hostname: "a", user: "u", lastUsed: 9 },
        { hostname: "", lastUsed: 3 },
        { hostname: "b", lastUsed: 5 },
        null,
      ]),
    );
    expect(parsed.map((e) => `${entryLabel(e)}:${e.lastUsed}`)).toEqual(["u@a:9", "b:5"]);
  });

  it("host ↔ entry round-trip omits default port", () => {
    const host = entryToHost({ hostname: "h", user: "u", lastUsed: 1 });
    expect(host).toEqual({ name: "h", hostname: "h", user: "u" });
    expect(hostToEntry({ name: "h", hostname: "h", user: "u", port: "22" })).toMatchObject({
      hostname: "h",
      user: "u",
    });
    expect(hostToEntry({ name: "h", hostname: "h", user: "u", port: "22" }).port).toBeUndefined();
  });

  it("sanitizeEntry rejects junk", () => {
    expect(sanitizeEntry(null)).toBeNull();
    expect(sanitizeEntry({ hostname: 1 })).toBeNull();
    expect(sanitizeEntry({ hostname: "ok", lastUsed: 2 })?.hostname).toBe("ok");
  });
});

describe("ssh-history MRU", () => {
  it("rememberInList bumps to front, dedupes, and caps at 30", () => {
    let list = rememberInList([], { name: "a", hostname: "a" }, 1);
    list = rememberInList(list, { name: "b", hostname: "b" }, 2);
    list = rememberInList(list, { name: "a", hostname: "a" }, 3);
    expect(list.map((e) => e.hostname)).toEqual(["a", "b"]);
    expect(list[0].lastUsed).toBe(3);

    for (let i = 0; i < 40; i++) {
      list = rememberInList(list, { name: `h${i}`, hostname: `h${i}` }, 100 + i);
    }
    expect(list).toHaveLength(30);
    expect(list[0].hostname).toBe("h39");
  });

  it("rememberSshHistory persists and updates cache", async () => {
    await rememberSshHistory({ name: "pi", hostname: "pi.lan", user: "pi", port: "22" });
    expect(listSshHistory()).toHaveLength(1);
    expect(listSshHistory()[0]).toMatchObject({ hostname: "pi.lan", user: "pi" });
    expect(JSON.parse(file.content)).toEqual([
      expect.objectContaining({ hostname: "pi.lan", user: "pi" }),
    ]);
    expect(JSON.parse(file.content)[0].port).toBeUndefined();

    await rememberSshHistory({ name: "lab", hostname: "lab", user: "root", port: "2222" });
    expect(listSshHistory().map((e) => entryLabel(e))).toEqual(["root@lab:2222", "pi@pi.lan"]);
  });

  it("load treats Rust empty-object fallback as no history", async () => {
    file.content = "{}";
    await loadSshHistory();
    expect(listSshHistory()).toEqual([]);
  });
});
