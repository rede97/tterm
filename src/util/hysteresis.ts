/**
 * Hysteresis comparator clamps current to an acceptable range derived
 * from floatVal, preventing oscillation during resize.
 *
 *   floatVal  continuous value (e.g. 107.3 cols would fit)
 *   current   current discrete value  (e.g. 107 cols)
 *   th_low    fraction of char needed below floor to accept floor
 *   th_high   fraction of char needed above floor to accept ceil
 *   min       floor clamp (default 2)
 */
export function hysteresis(
  floatVal: number,
  current: number,
  th_low: number,
  th_high: number,
  min = 2,
): number {
  if (!Number.isFinite(floatVal) || !Number.isFinite(current)) return min;
  const lo = Math.max(min, Math.floor(floatVal + (1.0 - th_low)));
  const hi = Math.ceil(floatVal - th_high);
  return Math.max(min, Math.min(hi, Math.max(lo, current)));
}
