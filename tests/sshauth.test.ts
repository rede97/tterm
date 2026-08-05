import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.resolve(null)) }));

const listeners = vi.hoisted(() => new Map<string, (e: { payload: unknown }) => void>());
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((event: string, cb: (e: { payload: unknown }) => void) => {
    listeners.set(event, cb);
    return Promise.resolve(() => {});
  }),
}));

import { invoke } from "@tauri-apps/api/core";
import { initSshAuthDialogs } from "../src/terminal/sshauth";

describe("SSH auth dialogs", () => {
  beforeAll(() => {
    initSshAuthDialogs();
    // idempotent: a second call must not re-register listeners
    initSshAuthDialogs();
    expect(listeners.has("ssh-auth-request")).toBe(true);
    expect(listeners.has("ssh-hostkey-request")).toBe(true);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    document.querySelectorAll(".sshauth-overlay").forEach(el => el.remove());
  });

  const fireAuth = (payload: unknown) => listeners.get("ssh-auth-request")!({ payload });
  const fireHostkey = (payload: unknown) => listeners.get("ssh-hostkey-request")!({ payload });
  const pressEscape = () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

  it("(a) auth request shows the prompt and OK sends the secret with matching reqId", () => {
    fireAuth({ reqId: 7, kind: "password", prompt: "user@host's password:" });

    const overlay = document.querySelector(".sshauth-overlay")!;
    expect(overlay).toBeTruthy();
    expect(overlay.querySelector(".sshauth-label")!.textContent).toBe("user@host's password:");

    const input = overlay.querySelector<HTMLInputElement>(".sshauth-input")!;
    expect(input.type).toBe("password");
    input.value = "s3cret";
    overlay.querySelector<HTMLButtonElement>(".sshauth-btn-ok")!.click();

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("ssh_auth_response", { reqId: 7, secret: "s3cret" });
    expect(document.querySelector(".sshauth-overlay")).toBeNull();
  });

  it("(b) Cancel responds with secret:null", () => {
    fireAuth({ reqId: 8, kind: "passphrase", prompt: "Enter passphrase for key '/home/u/.ssh/id_ed25519':" });

    const overlay = document.querySelector(".sshauth-overlay")!;
    overlay.querySelector<HTMLButtonElement>(".sshauth-btn-cancel")!.click();

    expect(invoke).toHaveBeenCalledWith("ssh_auth_response", { reqId: 8, secret: null });
    expect(document.querySelector(".sshauth-overlay")).toBeNull();
  });

  it("(c) hostkey request (first contact) shows fingerprint and Trust accepts", () => {
    fireHostkey({
      reqId: 11,
      host: "example.com",
      port: 22,
      keyType: "ssh-ed25519",
      fingerprint: "SHA256:abc123def456",
      mismatch: false,
    });

    const overlay = document.querySelector(".sshauth-overlay")!;
    expect(overlay.querySelector(".sshauth-header")!.textContent).toBe("Unknown SSH Host Key");
    expect(overlay.textContent).toContain("example.com:22");
    expect(overlay.textContent).toContain("ssh-ed25519");
    expect(overlay.textContent).toContain("SHA256:abc123def456");
    expect(overlay.querySelector(".sshauth-dialog-danger")).toBeNull();

    const trustBtn = [...overlay.querySelectorAll<HTMLButtonElement>("button")]
      .find(b => b.textContent === "Trust & Connect")!;
    trustBtn.click();

    expect(invoke).toHaveBeenCalledWith("ssh_hostkey_response", { reqId: 11, accept: true });
    expect(document.querySelector(".sshauth-overlay")).toBeNull();
  });

  it("(d) hostkey mismatch shows loud warning and Reject declines", () => {
    fireHostkey({
      reqId: 12,
      host: "example.com",
      port: 2222,
      keyType: "ssh-rsa",
      fingerprint: "SHA256:zzz999",
      mismatch: true,
    });

    const overlay = document.querySelector(".sshauth-overlay")!;
    expect(overlay.querySelector(".sshauth-dialog-danger")).not.toBeNull();
    expect(overlay.querySelector(".sshauth-header")!.textContent).toBe("WARNING: SSH Host Key CHANGED");
    expect(overlay.textContent).toContain("man-in-the-middle");
    expect(overlay.textContent).toContain("SHA256:zzz999");

    const rejectBtn = [...overlay.querySelectorAll<HTMLButtonElement>("button")]
      .find(b => b.textContent === "Reject")!;
    rejectBtn.click();

    expect(invoke).toHaveBeenCalledWith("ssh_hostkey_response", { reqId: 12, accept: false });
  });

  it("(e) Escape answers auth with null and hostkey with false — no prompt left unanswered", () => {
    fireAuth({ reqId: 20, kind: "password", prompt: "pw:" });
    pressEscape();
    expect(invoke).toHaveBeenCalledWith("ssh_auth_response", { reqId: 20, secret: null });

    fireHostkey({
      reqId: 21, host: "h", port: 22, keyType: "ssh-ed25519", fingerprint: "SHA256:x", mismatch: false,
    });
    pressEscape();
    expect(invoke).toHaveBeenCalledWith("ssh_hostkey_response", { reqId: 21, accept: false });

    expect(document.querySelector(".sshauth-overlay")).toBeNull();
  });

  it("Enter in the password input submits like OK", () => {
    fireAuth({ reqId: 30, kind: "password", prompt: "pw:" });
    const input = document.querySelector<HTMLInputElement>(".sshauth-input")!;
    input.value = "typed";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(invoke).toHaveBeenCalledWith("ssh_auth_response", { reqId: 30, secret: "typed" });
  });

  it("responds exactly once per prompt even if multiple dismissal paths fire", () => {
    fireAuth({ reqId: 40, kind: "password", prompt: "pw:" });
    const overlay = document.querySelector(".sshauth-overlay")!;
    overlay.querySelector<HTMLButtonElement>(".sshauth-btn-cancel")!.click();
    pressEscape();
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
