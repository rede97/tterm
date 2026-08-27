import { describe, expect, it } from "vitest";
import {
  FORWARD_KIND_LABELS,
  formatForwardSpec,
  forwardRoute,
  parseForwardSpec,
  sameListen,
} from "../src/ui/forwardspec";

describe("parseForwardSpec", () => {
  it("returns null for empty or incomplete input", () => {
    expect(parseForwardSpec("")).toBeNull();
    expect(parseForwardSpec("   ")).toBeNull();
    expect(parseForwardSpec("L")).toBeNull();
    expect(parseForwardSpec("8080")).toBeNull();
    expect(parseForwardSpec("L 8080:host")).toBeNull();
    expect(parseForwardSpec("D host")).toBeNull();
  });

  it("parses local with default bind and optional L prefix", () => {
    const spec = {
      kind: "local",
      listenHost: "127.0.0.1",
      listenPort: 8080,
      targetHost: "localhost",
      targetPort: 3000,
    };
    expect(parseForwardSpec("L 8080:localhost:3000")).toEqual(spec);
    expect(parseForwardSpec("8080:localhost:3000")).toEqual(spec);
    expect(parseForwardSpec("-L 8080:localhost:3000")).toEqual(spec);
  });

  it("parses remote, dynamic, glued prefix, and explicit listen host", () => {
    expect(parseForwardSpec("R 2222:127.0.0.1:22")).toEqual({
      kind: "remote",
      listenHost: "127.0.0.1",
      listenPort: 2222,
      targetHost: "127.0.0.1",
      targetPort: 22,
    });
    expect(parseForwardSpec("D 1080")).toEqual({
      kind: "dynamic",
      listenHost: "127.0.0.1",
      listenPort: 1080,
      targetHost: "",
      targetPort: 0,
    });
    expect(parseForwardSpec("D1080")).toEqual(parseForwardSpec("D 1080"));
    expect(parseForwardSpec("L 0.0.0.0:8080:db.internal:5432")).toEqual({
      kind: "local",
      listenHost: "0.0.0.0",
      listenPort: 8080,
      targetHost: "db.internal",
      targetPort: 5432,
    });
  });

  it("rejects out-of-range ports", () => {
    expect(parseForwardSpec("L 99999:localhost:3000")).toBeNull();
    expect(parseForwardSpec("D 0")).toBeNull();
  });
});

describe("formatForwardSpec / forwardRoute", () => {
  it("round-trips the default-bind local form", () => {
    const spec = parseForwardSpec("L 8080:db.internal:5432")!;
    expect(formatForwardSpec(spec)).toBe("L 8080:db.internal:5432");
    expect(forwardRoute(spec)).toBe("127.0.0.1:8080 → db.internal:5432");
    expect(FORWARD_KIND_LABELS[spec.kind]).toBe("Local (-L)");
  });

  it("formats dynamic as D port and SOCKS5 route", () => {
    const spec = parseForwardSpec("D 1080")!;
    expect(formatForwardSpec(spec)).toBe("D 1080");
    expect(forwardRoute(spec)).toBe("127.0.0.1:1080 → SOCKS5");
  });

  it("sameListen matches kind + listen, not target", () => {
    const a = parseForwardSpec("L 8080:a:1")!;
    const b = parseForwardSpec("L 8080:b:2")!;
    const c = parseForwardSpec("R 8080:a:1")!;
    expect(sameListen(a, b)).toBe(true);
    expect(sameListen(a, c)).toBe(false);
  });
});
