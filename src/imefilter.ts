// Stable-run cursor filter for IME anchoring.
// During animated terminal output the instantaneous cursor position is
// unreliable: redraws bounce the cursor through transient cells for a few
// frames at a time. But a plain mode/vote over a time window is too sluggish —
// it keeps anchoring at the OLD position for hundreds of ms after the cursor
// genuinely moves (e.g. Enter redraws the prompt on a new line).
//
// This filter instead tracks "stable runs": a cursor position only counts
// once it has been held continuously for minStableMs. Transient animation
// cells never survive that threshold, while genuine cursor moves are accepted
// after a bounded delay. The estimate is:
//   1. the current run, once it has proven stable
//   2. otherwise the most recent stable run (if it ended recently)
//   3. otherwise the instantaneous position

export interface CellPos {
  x: number; // column, 0-based
  y: number; // row, 0-based, relative to viewport
}

interface Run {
  x: number;
  y: number;
  start: number; // run start timestamp (performance.now)
}

interface CompletedRun extends Run {
  end: number; // when the run was broken by a position change
}

export class CursorPositionFilter {
  private current: Run | null = null;
  private lastStable: CompletedRun | null = null;

  constructor(
    private minStableMs = 120,    // a run held this long counts as settled
    private maxStableAgeMs = 3000 // ignore stable runs that ended longer ago
  ) {}

  sample(x: number, y: number): void {
    const now = performance.now();
    if (this.current && this.current.x === x && this.current.y === y) return;
    // Run broken: record it as a stable anchor candidate if it lasted.
    if (this.current && now - this.current.start >= this.minStableMs) {
      this.lastStable = { ...this.current, end: now };
    }
    this.current = { x, y, start: now };
  }

  // Best estimate of the settled cursor position (see header).
  position(): CellPos | null {
    if (!this.current) return null;
    const now = performance.now();
    if (now - this.current.start >= this.minStableMs) {
      return { x: this.current.x, y: this.current.y };
    }
    if (this.lastStable && now - this.lastStable.end <= this.maxStableAgeMs) {
      return { x: this.lastStable.x, y: this.lastStable.y };
    }
    return { x: this.current.x, y: this.current.y };
  }

  reset(): void {
    this.current = null;
    this.lastStable = null;
  }
}
