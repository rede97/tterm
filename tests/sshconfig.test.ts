import { describe, it, expect } from "vitest";
import { parseSshConfig, generateSshConfig } from "../src/config/ssh-config";
import type { SshHost } from "../src/core/types";

describe("parseSshConfig", () => {
  it("parses a simple host block", () => {
    const hosts = parseSshConfig(`Host myserver
    HostName 192.168.1.10
    User admin
    Port 2222
`);
    expect(hosts).toHaveLength(1);
    expect(hosts[0].name).toBe("myserver");
    expect(hosts[0].HostName).toBe("192.168.1.10");
    expect(hosts[0].User).toBe("admin");
    expect(hosts[0].Port).toBe("2222");
  });

  it("skips comments and empty lines", () => {
    const hosts = parseSshConfig(`# a comment

Host web
    HostName example.com
`);
    expect(hosts).toHaveLength(1);
    expect(hosts[0].name).toBe("web");
  });

  it("applies global (pre-Host) options to every host", () => {
    const hosts = parseSshConfig(`ForwardAgent yes

Host a
    HostName a.example.com

Host b
    HostName b.example.com
`);
    expect(hosts).toHaveLength(2);
    expect(hosts[0].ForwardAgent).toBe("yes");
    expect(hosts[1].ForwardAgent).toBe("yes");
  });

  it("host-specific options override globals", () => {
    const hosts = parseSshConfig(`User default

Host special
    HostName s.example.com
    User override
`);
    expect(hosts[0].User).toBe("override");
  });

  it("expands multiple names on one Host line into separate hosts", () => {
    const hosts = parseSshConfig(`Host web1 web2
    HostName web.example.com
`);
    expect(hosts.map(h => h.name)).toEqual(["web1", "web2"]);
  });

  it("applies wildcard Host * properties to all hosts without emitting a host", () => {
    const hosts = parseSshConfig(`Host *
    ServerAliveInterval 60

Host db
    HostName db.internal
`);
    expect(hosts).toHaveLength(1);
    expect(hosts[0].name).toBe("db");
    expect(hosts[0].ServerAliveInterval).toBe("60");
  });

  it("returns empty array for empty input", () => {
    expect(parseSshConfig("")).toEqual([]);
  });

  it("merges repeated LocalForward/RemoteForward directives instead of dropping them", () => {
    const hosts = parseSshConfig(`Host db
    HostName db.internal
    LocalForward 127.0.0.1:8080 127.0.0.1:80
    LocalForward 127.0.0.1:5432 db.internal:5432
    RemoteForward 127.0.0.1:9090 127.0.0.1:3000
`);
    expect(hosts).toHaveLength(1);
    expect(hosts[0].LocalForward).toBe(
      "127.0.0.1:8080 127.0.0.1:80\n127.0.0.1:5432 db.internal:5432",
    );
    expect(hosts[0].RemoteForward).toBe("127.0.0.1:9090 127.0.0.1:3000");
  });

  it("non-forward repeated keywords keep last-wins behavior", () => {
    const hosts = parseSshConfig(`Host h
    HostName a.example.com
    HostName b.example.com
`);
    expect(hosts[0].HostName).toBe("b.example.com");
  });
});

describe("generateSshConfig", () => {
  it("writes canonical fields first, preserving original key casing", () => {
    const out = generateSshConfig([
      { name: "myserver", HostName: "10.0.0.1", User: "root", Port: "22" },
    ]);
    const lines = out.split("\n");
    expect(lines).toContain("Host myserver");
    const idxHost = lines.indexOf("    HostName 10.0.0.1");
    const idxUser = lines.indexOf("    User root");
    const idxPort = lines.indexOf("    Port 22");
    expect(idxHost).toBeGreaterThan(-1);
    expect(idxUser).toBeGreaterThan(idxHost);
    expect(idxPort).toBeGreaterThan(idxUser);
  });

  it("includes extra properties after canonical fields", () => {
    const out = generateSshConfig([
      { name: "h", HostName: "x", IdentityFile: "~/.ssh/id_ed25519" },
    ]);
    expect(out).toContain("    IdentityFile ~/.ssh/id_ed25519");
  });

  it("round-trips through parseSshConfig", () => {
    const original: SshHost[] = [
      { name: "alpha", HostName: "alpha.example.com", User: "alice", Port: "2201" },
      { name: "beta", HostName: "beta.example.com", ForwardAgent: "yes" },
    ];
    const regenerated = parseSshConfig(generateSshConfig(original));
    expect(regenerated).toHaveLength(2);
    expect(regenerated[0]).toMatchObject(original[0]);
    expect(regenerated[1]).toMatchObject(original[1]);
  });

  it("expands multi-line forward values back to one directive per line", () => {
    const out = generateSshConfig([
      {
        name: "db",
        HostName: "db.internal",
        LocalForward: "127.0.0.1:8080 127.0.0.1:80\n127.0.0.1:5432 db.internal:5432",
      },
    ]);
    expect(out).toContain("    LocalForward 127.0.0.1:8080 127.0.0.1:80\n");
    expect(out).toContain("    LocalForward 127.0.0.1:5432 db.internal:5432\n");
    // And the expanded form parses back to the same merged value.
    const reparsed = parseSshConfig(out);
    expect(reparsed[0].LocalForward).toBe(
      "127.0.0.1:8080 127.0.0.1:80\n127.0.0.1:5432 db.internal:5432",
    );
  });
});

describe("case-insensitive keywords (regression)", () => {
  it("merges forward directives regardless of casing", () => {
    const hosts = parseSshConfig([
      "Host box",
      "  HostName 10.0.0.1",
      "  LocalForward 8080 localhost:80",
      "  localforward 9090 localhost:90",
    ].join("\n"));
    // One property, both rules preserved (was: second overwrote/split off)
    const keys = Object.keys(hosts[0]).filter(k => k.toLowerCase() === "localforward");
    expect(keys).toHaveLength(1);
    expect(hosts[0][keys[0]]).toBe("8080 localhost:80\n9090 localhost:90");
  });

  it("non-forward keywords keep last-wins regardless of casing", () => {
    const hosts = parseSshConfig([
      "Host box",
      "  HostName 10.0.0.1",
      "  hostname 10.0.0.2",
    ].join("\n"));
    const keys = Object.keys(hosts[0]).filter(k => k.toLowerCase() === "hostname");
    expect(keys).toHaveLength(1);
    expect(hosts[0][keys[0]]).toBe("10.0.0.2");
  });
});
