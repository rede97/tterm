import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CursorPositionFilter } from "../src/util/imefilter";

// The filter timestamps everything with performance.now(); fake timers mock it.
describe("CursorPositionFilter", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function advance(ms: number) {
    vi.advanceTimersByTime(ms);
  }

  it("returns null before any sample", () => {
    const f = new CursorPositionFilter();
    expect(f.position()).toBeNull();
  });

  it("accepts a position once held past the stable threshold", () => {
    const f = new CursorPositionFilter();
    f.sample(5, 3);
    advance(50);
    f.sample(5, 3);
    // Not yet stable — falls back to current (no prior stable run)
    expect(f.position()).toEqual({ x: 5, y: 3 });
    advance(100); // total 150ms >= 120ms
    expect(f.position()).toEqual({ x: 5, y: 3 });
  });

  it("rejects transient animation cells during jitter", () => {
    const f = new CursorPositionFilter();
    // Settle at A
    f.sample(10, 1);
    advance(500);
    // Animation: bounce to B for a few frames, back to A
    f.sample(20, 1);
    advance(30);
    f.sample(10, 1);
    advance(30);
    // B never survived 120ms; A's run continues
    expect(f.position()).toEqual({ x: 10, y: 1 });
  });

  it("keeps anchoring at the old position while a new position is unproven", () => {
    const f = new CursorPositionFilter();
    f.sample(10, 1);
    advance(500);
    f.sample(10, 1); // stable at A
    // Genuine move to B, but only 50ms ago
    f.sample(10, 2);
    advance(50);
    expect(f.position()).toEqual({ x: 10, y: 1 }); // last stable run wins
    // After the threshold, the move is accepted
    advance(100);
    expect(f.position()).toEqual({ x: 10, y: 2 });
  });

  it("accepts a genuine move quickly (Enter + immediate IME input)", () => {
    const f = new CursorPositionFilter();
    f.sample(0, 5);
    advance(1000);
    f.sample(0, 5); // stable at old prompt line
    f.sample(0, 6); // Enter: new line
    advance(150); // 150ms later user starts composition
    expect(f.position()).toEqual({ x: 0, y: 6 }); // new line, not stale old line
  });

  it("ignores a stale stable run that ended long ago", () => {
    const f = new CursorPositionFilter();
    f.sample(1, 1);
    advance(500);
    f.sample(1, 1); // stable at A
    f.sample(2, 2); // move to B
    advance(30);
    f.sample(2, 2);
    // A ended only 30ms ago — still valid fallback
    expect(f.position()).toEqual({ x: 1, y: 1 });
    // Move again, no stable run for > 3s
    f.sample(3, 3);
    advance(3100);
    // C is now stable itself (3.1s > 120ms), so current wins regardless
    expect(f.position()).toEqual({ x: 3, y: 3 });
  });

  it("handles cursor sitting idle with no samples (gap = stable)", () => {
    const f = new CursorPositionFilter();
    f.sample(7, 7);
    advance(10000); // idle: no renders, no samples
    // Long gap counts as a stable run at the same position
    expect(f.position()).toEqual({ x: 7, y: 7 });
  });

  it("reset() clears all state", () => {
    const f = new CursorPositionFilter();
    f.sample(1, 1);
    advance(500);
    f.reset();
    expect(f.position()).toBeNull();
  });
});
