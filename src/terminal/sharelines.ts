// AI session sharing: absolute line addressing over the xterm buffer.
//
// Model (see docs/ai-session-sharing.md):
//   absolute_line = trimBase + bufferY
// - trimBase counts lines trimmed off the scrollback top (xterm's internal
//   CircularList.onTrim is the only accurate signal — public events do not
//   fire when the buffer is full and lines cycle).
// - epoch invalidates every outstanding address: clear()/ED3 (detected as
//   a drop of trimBase+length without a matching trim), resize (reflow
//   re-wraps lines), and normal/alternate buffer switches.
// - If xterm's internals are unavailable (upgrade), onBufferTrim returns
//   null and absolute addresses can no longer be trusted: the state is
//   flagged `addressing: false` and reported in every response.

import type { Terminal } from "@xterm/xterm";
import { onBufferTrim } from "../util/xterm-internals";

export interface ShareLineState {
  epoch: number;
  trimBase: number;
  // trimBase + buf.length sampled at the last read/event — a DROP without a
  // matching trim means clear()/ED3 wiped lines: bump epoch.
  lastTotal: number;
  // Append log for /lines?since=: one entry per render that GREW the
  // buffer, {seq at that render, total after}. Content-only renders
  // (cursor blink, in-place rewrites) leave no entry — `since` answers
  // "what was appended", rewrites are /screen's job.
  seqLog: { seq: number; total: number }[];
  // False when xterm internals didn't yield an onTrim subscription —
  // absolute addresses can't be trusted; reads degrade to tail-only.
  addressing: boolean;
  disposables: { dispose(): void }[];
}

const states = new WeakMap<Terminal, ShareLineState>();

/** Per-request cap; larger reads page via before/count. */
export const SHARE_LINES_MAX = 2000;
/** Append-log ring size; agents holding older seqs get unknown_seq. */
const SEQ_LOG_MAX = 256;

export interface ShareLinesQuery {
  tail?: number;
  before?: number;
  count?: number;
  from?: number;
  to?: number;
  since?: number;
  epoch?: number;
}

/** Line-address state for a terminal, attaching trackers on first call.
 * The factory calls this at terminal birth — trims before attach are
 * untracked, so addresses are only valid from the attach point. */
export function shareLineState(term: Terminal): ShareLineState {
  const existing = states.get(term);
  if (existing) return existing;
  const st: ShareLineState = {
    epoch: 0,
    trimBase: 0,
    lastTotal: term.buffer.active.length,
    // Seed at total 0 (not the initial viewport's empty filler lines):
    // over-reading is safe for since clients (they dedup by anchor),
    // skipping real content is not.
    seqLog: [{ seq: 0, total: 0 }],
    addressing: true,
    disposables: [],
  };
  states.set(term, st);

  const hookTrim = () => {
    const sub = onBufferTrim(term, (n) => {
      st.trimBase += n;
    });
    if (!sub) st.addressing = false;
    return sub;
  };
  const trimSub = hookTrim();
  if (trimSub) st.disposables.push(trimSub);

  // Resize reflows wrapped lines — buffer indices shift; invalidate.
  st.disposables.push(
    term.onResize(() => {
      st.epoch++;
      st.seqLog.length = 0;
    }),
  );
  // Normal/alternate buffer switch: each buffer has its own line list and
  // its own trim stream. Re-hook trims on the newly active buffer and
  // invalidate addresses (the alt screen has no shared history).
  st.disposables.push(
    term.buffer.onBufferChange(() => {
      st.epoch++;
      st.seqLog.length = 0;
      const sub = hookTrim();
      if (sub) st.disposables.push(sub);
    }),
  );
  return st;
}

/** Record a render's seq (called from the tab's onRender, AFTER shareSeq++
 * so the ordering question never arises). Only appends — renders that grew
 * the buffer — create log entries. */
export function recordShareSeq(term: Terminal, seq: number): void {
  const st = states.get(term);
  if (!st) return;
  const total = st.trimBase + term.buffer.active.length;
  const last = st.seqLog[st.seqLog.length - 1];
  if (last && last.total === total) return;
  st.seqLog.push({ seq, total });
  if (st.seqLog.length > SEQ_LOG_MAX) st.seqLog.shift();
}

/** Snapshot totals; bumps epoch when lines vanished without a trim. */
function sample(term: Terminal, st: ShareLineState): number {
  const total = st.trimBase + term.buffer.active.length;
  if (total < st.lastTotal) {
    st.epoch++;
    // Addresses are void; the next render re-seeds the log via
    // recordShareSeq. Reseeding here with a synthetic seq would make
    // pre-bump seqs floor-match and silently answer "nothing new".
    st.seqLog.length = 0;
  }
  st.lastTotal = total;
  return total;
}

/** Read a line range with absolute addressing. Query forms (exactly one):
 *   { tail: N }            last N lines
 *   { before: A, count: N } N lines ending before absolute line A
 *   { from: A, to: B }     absolute half-open range [A, B)
 * Every response carries epoch/total/from so the caller can re-anchor. */
export function readShareLines(term: Terminal, q: ShareLinesQuery): Record<string, unknown> {
  const st = shareLineState(term);
  const buf = term.buffer.active;
  const total = sample(term, st);

  if (q.epoch !== undefined && q.epoch !== st.epoch) {
    return { error: "stale_epoch", epoch: st.epoch, total };
  }

  const cap = (n: number) => Math.min(Math.max(0, Math.floor(n)), SHARE_LINES_MAX);
  let from: number;
  let to: number;
  let truncated = false;
  if (q.since !== undefined) {
    // Appends since the client's seq: floor-entry lookup over the append
    // log (content-only renders never logged, so floor == total at that seq).
    let base: number | null = null;
    for (const e of st.seqLog) {
      if (e.seq <= q.since) base = e.total;
      else break;
    }
    if (base === null) {
      // Seq predates the log (ring eviction or an epoch bump): re-anchor.
      return { error: "unknown_seq", epoch: st.epoch, total };
    }
    from = base;
    to = total;
    if (to - from > SHARE_LINES_MAX) {
      to = from + SHARE_LINES_MAX;
      truncated = true;
    }
  } else if (q.tail !== undefined) {
    const n = cap(q.tail);
    truncated = q.tail > n;
    to = total;
    from = Math.max(st.trimBase, to - n);
  } else if (q.before !== undefined || q.count !== undefined) {
    if (q.before === undefined || q.count === undefined) {
      return { error: "bad_range", epoch: st.epoch, total };
    }
    const n = cap(q.count);
    truncated = q.count > n;
    to = Math.min(Math.max(q.before, st.trimBase), total);
    from = Math.max(st.trimBase, to - n);
  } else if (q.from !== undefined || q.to !== undefined) {
    if (q.from === undefined || q.to === undefined || q.from > q.to) {
      return { error: "bad_range", epoch: st.epoch, total };
    }
    to = Math.min(q.to, total);
    from = Math.max(q.from, st.trimBase);
    if (to - from > SHARE_LINES_MAX) {
      to = from + SHARE_LINES_MAX;
      truncated = true;
    }
  } else {
    return { error: "bad_range", epoch: st.epoch, total };
  }

  const lines: string[] = [];
  for (let abs = from; abs < to; abs++) {
    lines.push(buf.getLine(abs - st.trimBase)?.translateToString(true) ?? "");
  }
  return {
    epoch: st.epoch,
    total,
    from,
    count: lines.length,
    lines,
    alt_screen: buf.type === "alternate",
    viewport_first: st.trimBase + buf.viewportY,
    addressing: st.addressing,
    ...(truncated ? { truncated: true } : {}),
  };
}
