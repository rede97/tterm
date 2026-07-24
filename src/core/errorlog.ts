// Unified error logging — replaces bare catch {} and .catch(() => {}) patterns.
// Future extension: write to file, send to toast, or report to telemetry.

const PREFIX = "[tterm]";

export function logError(context: string, error: unknown): void {
  console.error(`${PREFIX} ${context}:`, error);
}

/** Returns a catch handler for Promise chains. Usage: .catch(logCatch("clipboard.write")) */
export function logCatch(context: string): (e: unknown) => void {
  return (e: unknown) => logError(context, e);
}

/** Swallow an error silently (use only when the error is truly unimportant). */
export function swallow(): void {
  // intentionally empty — only use when you're certain the error doesn't matter
}
