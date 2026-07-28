import { describe, it, expect } from "vitest";
import {
  shouldAutoReattach,
  reattachDelayForAttempt,
  REATTACH_DELAYS,
} from "../src/util/disconnect";

// Session death is handled in-band by the backend (deadmode.rs: reset +
// notice printed into the terminal stream, Enter respawns). These helpers
// only govern the TRANSPORT layer: silent re-attach after abnormal drops
// (OS sleep/wake resetting loopback TCP).

describe("shouldAutoReattach", () => {
  it("reattaches on abnormal close (sleep/wake, TCP reset)", () => {
    expect(shouldAutoReattach(false)).toBe(true);
  });

  it("does not reattach on clean close (relay slot torn down)", () => {
    expect(shouldAutoReattach(true)).toBe(false);
  });
});

describe("reattachDelayForAttempt", () => {
  it("returns the scheduled delay for each attempt", () => {
    expect(reattachDelayForAttempt(0)).toBe(REATTACH_DELAYS[0]);
    expect(reattachDelayForAttempt(1)).toBe(REATTACH_DELAYS[1]);
    expect(reattachDelayForAttempt(REATTACH_DELAYS.length - 1)).toBe(
      REATTACH_DELAYS[REATTACH_DELAYS.length - 1],
    );
  });

  it("returns null once attempts are exhausted", () => {
    expect(reattachDelayForAttempt(REATTACH_DELAYS.length)).toBeNull();
    expect(reattachDelayForAttempt(REATTACH_DELAYS.length + 5)).toBeNull();
  });

  it("rejects negative attempts", () => {
    expect(reattachDelayForAttempt(-1)).toBeNull();
  });

  it("first retry is immediate so sleep/wake reconnects invisibly", () => {
    expect(REATTACH_DELAYS[0]).toBe(0);
  });
});
