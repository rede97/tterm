import { beforeEach, describe, expect, it } from "vitest";
import { createForwardEditor } from "../src/ui/forwardeditor";

function parts(root: HTMLElement) {
  const cols = root.querySelectorAll<HTMLElement>(".xfe-col");
  const arrow = root.querySelector<HTMLButtonElement>(".xfe-arrow")!;
  const hosts = root.querySelectorAll<HTMLInputElement>(".xfe-host");
  const ports = root.querySelectorAll<HTMLInputElement>(".xfe-port");
  return {
    arrow,
    localCol: cols[0],
    remoteCol: cols[1],
    localHost: hosts[0],
    remoteHost: hosts[1],
    localPort: ports[0],
    remotePort: ports[1],
  };
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("forward editor — direction and locked side", () => {
  it("defaults to → (local): Local host pinned to 127.0.0.1 and disabled, Remote editable", () => {
    const ed = createForwardEditor();
    const p = parts(ed.el);
    expect(ed.kind()).toBe("local");
    expect(p.arrow.textContent).toBe("→");
    expect(p.localHost.disabled).toBe(true);
    expect(p.localHost.value).toBe("127.0.0.1");
    expect(p.remoteHost.disabled).toBe(false);
  });

  it("toggling the arrow flips kind and moves the lock to the Remote side", () => {
    const ed = createForwardEditor();
    const p = parts(ed.el);
    p.arrow.click();
    expect(ed.kind()).toBe("remote");
    expect(p.arrow.textContent).toBe("←");
    expect(p.remoteHost.disabled).toBe(true);
    expect(p.remoteHost.value).toBe("127.0.0.1");
    expect(p.localHost.disabled).toBe(false);
  });

  it("typed host survives a direction round-trip", () => {
    const ed = createForwardEditor();
    const p = parts(ed.el);
    p.remoteHost.value = "db.internal";
    p.remoteHost.dispatchEvent(new Event("input"));
    p.arrow.click(); // remote side locked: shows 127.0.0.1
    expect(p.remoteHost.value).toBe("127.0.0.1");
    p.arrow.click(); // back to local: typed value restored
    expect(p.remoteHost.value).toBe("db.internal");
  });
});

describe("forward editor — read() mapping", () => {
  it("→ maps Local:port to listen and Remote host:port to target", () => {
    const ed = createForwardEditor();
    const p = parts(ed.el);
    p.localPort.value = "8080";
    p.remoteHost.value = "db.internal";
    p.remoteHost.dispatchEvent(new Event("input"));
    p.remotePort.value = "5432";
    expect(ed.read()).toEqual({
      kind: "local",
      listenHost: "127.0.0.1",
      listenPort: 8080,
      targetHost: "db.internal",
      targetPort: 5432,
    });
  });

  it("← maps Remote:port to listen and Local host:port to target", () => {
    const ed = createForwardEditor();
    const p = parts(ed.el);
    p.arrow.click();
    p.remotePort.value = "9090";
    p.localHost.value = "192.168.1.50";
    p.localHost.dispatchEvent(new Event("input"));
    p.localPort.value = "3000";
    expect(ed.read()).toEqual({
      kind: "remote",
      listenHost: "127.0.0.1",
      listenPort: 9090,
      targetHost: "192.168.1.50",
      targetPort: 3000,
    });
  });

  it("returns null when a port is missing or out of range", () => {
    const ed = createForwardEditor();
    const p = parts(ed.el);
    expect(ed.read()).toBeNull();
    p.localPort.value = "8080";
    p.remotePort.value = "0";
    expect(ed.read()).toBeNull();
    p.remotePort.value = "65536";
    expect(ed.read()).toBeNull();
    p.remotePort.value = "80";
    expect(ed.read()).not.toBeNull();
  });

  it("blank target host falls back to 127.0.0.1", () => {
    const ed = createForwardEditor();
    const p = parts(ed.el);
    p.localPort.value = "8080";
    p.remotePort.value = "80";
    expect(ed.read()!.targetHost).toBe("127.0.0.1");
  });

  it("reset() clears ports but keeps hosts and direction", () => {
    const ed = createForwardEditor();
    const p = parts(ed.el);
    p.remoteHost.value = "db.internal";
    p.remoteHost.dispatchEvent(new Event("input"));
    p.localPort.value = "8080";
    p.remotePort.value = "5432";
    ed.reset();
    expect(p.localPort.value).toBe("");
    expect(p.remotePort.value).toBe("");
    expect(p.remoteHost.value).toBe("db.internal");
    expect(ed.kind()).toBe("local");
  });
});
