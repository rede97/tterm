// Reconnect policy helpers for the session WebSocket.
//
// Session death (shell exit, serial unplug) is handled IN-BAND by the
// backend: the relay keeps the socket alive, prints a reset+notice into the
// terminal stream, and respawns on Enter (see deadmode.rs). What remains
// here is the TRANSPORT layer: an abnormal socket drop (OS sleep/wake
// resetting loopback TCP, WebView2 discarding the socket) is not a session
// death, so we silently re-attach instead of disturbing the user.

// Should an abnormal socket close trigger a silent re-attach attempt?
// A CLEAN close (wasClean) means the backend sent a WS Close frame, which
// only happens when the relay slot is torn down for good (tab kill).
// Anything else (1006) is transport-level: the session may well be alive.
export function shouldAutoReattach(wasClean: boolean): boolean {
  return !wasClean;
}

// Backoff schedule (ms) for silent re-attach attempts. The first retry is
// immediate (the common sleep/wake case reconnects invisibly); later retries
// also cover the relay needing a moment to release a stale half-open slot.
export const REATTACH_DELAYS = [0, 300, 1000, 3000];

// Delay before re-attach attempt `attempt` (0-based), or null to give up.
export function reattachDelayForAttempt(attempt: number): number | null {
  return attempt >= 0 && attempt < REATTACH_DELAYS.length ? REATTACH_DELAYS[attempt] : null;
}
