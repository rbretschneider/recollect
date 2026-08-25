const MINUTES_TO_MILLISECONDS = 60 * 1000;

/**
 * Computes the local calendar day (`YYYY-MM-DD`) a capture belongs to, using the
 * capture's original timezone offset when known. Maintained by the app on every
 * capturedAt write (see data-model.md §3.2).
 */
export function toCapturedDay(capturedAt: Date, tzOffsetMinutes: number | null): string {
  const shifted = new Date(capturedAt.getTime() + (tzOffsetMinutes ?? 0) * MINUTES_TO_MILLISECONDS);
  return shifted.toISOString().slice(0, 'YYYY-MM-DD'.length);
}
