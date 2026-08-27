// SSH port-forward one-liner — palette input grammar shared by the app
// (`palette.ts`) and `docs/command-palette-preview.html`.
//
//   [L|R|D] listen[:host:port]
//   L 8080:localhost:3000     local  (-L), bind 127.0.0.1
//   8080:localhost:3000       same (default L)
//   R 2222:127.0.0.1:22       remote (-R)
//   D 1080                    dynamic (-D) SOCKS5
//   L 0.0.0.0:8080:host:3000  explicit listen host
//
// IPv6 is out of scope (colon-splitting). Invalid input returns null.

export type ForwardKind = "local" | "remote" | "dynamic";

export interface ForwardSpec {
  kind: ForwardKind;
  listenHost: string;
  listenPort: number;
  targetHost: string;
  targetPort: number;
}

export const FORWARD_KIND_LABELS: Record<ForwardKind, string> = {
  local: "Local (-L)",
  remote: "Remote (-R)",
  dynamic: "Dynamic (-D)",
};

export const FORWARD_SPEC_HINT = "Use L|R|D listen[:host:port]";

function isListenPort(s: string): boolean {
  if (!/^\d+$/.test(s)) return false;
  const n = Number(s);
  return Number.isInteger(n) && n >= 1 && n <= 65535;
}

function letterKind(letter: string): ForwardKind {
  const l = letter.replace("-", "").toLowerCase();
  if (l === "r") return "remote";
  if (l === "d") return "dynamic";
  return "local";
}

/** ssh -L/-R/-D one-liner. Default kind L. */
export function parseForwardSpec(raw: string): ForwardSpec | null {
  const s = raw.trim();
  if (!s) return null;
  let kind: ForwardKind = "local";
  let rest = s;
  const spaced = s.match(/^(-?[lrd])\s+(.+)$/i);
  const glued = s.match(/^(-?[lrd])(\d[\d.:]*)$/i);
  if (spaced) {
    kind = letterKind(spaced[1] ?? "");
    rest = (spaced[2] ?? "").trim();
  } else if (glued) {
    kind = letterKind(glued[1] ?? "");
    rest = glued[2] ?? "";
  }
  if (!rest) return null;
  const parts = rest.split(":");
  if (kind === "dynamic") {
    if (parts.length === 1 && parts[0] && isListenPort(parts[0])) {
      return {
        kind,
        listenHost: "127.0.0.1",
        listenPort: Number(parts[0]),
        targetHost: "",
        targetPort: 0,
      };
    }
    if (parts.length === 2 && parts[0] && parts[1] && isListenPort(parts[1])) {
      return {
        kind,
        listenHost: parts[0],
        listenPort: Number(parts[1]),
        targetHost: "",
        targetPort: 0,
      };
    }
    return null;
  }
  if (
    parts.length === 3 &&
    parts[0] &&
    parts[1] &&
    parts[2] &&
    isListenPort(parts[0]) &&
    isListenPort(parts[2])
  ) {
    return {
      kind,
      listenHost: "127.0.0.1",
      listenPort: Number(parts[0]),
      targetHost: parts[1],
      targetPort: Number(parts[2]),
    };
  }
  if (
    parts.length === 4 &&
    parts[0] &&
    parts[1] &&
    parts[2] &&
    parts[3] &&
    isListenPort(parts[1]) &&
    isListenPort(parts[3])
  ) {
    return {
      kind,
      listenHost: parts[0],
      listenPort: Number(parts[1]),
      targetHost: parts[2],
      targetPort: Number(parts[3]),
    };
  }
  return null;
}

export function forwardRoute(f: ForwardSpec): string {
  const listen = `${f.listenHost}:${f.listenPort}`;
  return f.kind === "dynamic"
    ? `${listen} → SOCKS5`
    : `${listen} → ${f.targetHost}:${f.targetPort}`;
}

export function formatForwardSpec(f: ForwardSpec): string {
  const letter = f.kind === "remote" ? "R" : f.kind === "dynamic" ? "D" : "L";
  if (f.kind === "dynamic") {
    return f.listenHost === "127.0.0.1"
      ? `${letter} ${f.listenPort}`
      : `${letter} ${f.listenHost}:${f.listenPort}`;
  }
  const listen =
    f.listenHost === "127.0.0.1" ? `${f.listenPort}` : `${f.listenHost}:${f.listenPort}`;
  return `${letter} ${listen}:${f.targetHost}:${f.targetPort}`;
}

export function sameListen(a: ForwardSpec, b: ForwardSpec): boolean {
  return a.kind === b.kind && a.listenHost === b.listenHost && a.listenPort === b.listenPort;
}
