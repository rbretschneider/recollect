/**
 * When the library rescans on its own. 'interval' is the legacy env-driven
 * default (~daily); 'every' is a user-chosen minutes cadence for NAS drops that
 * should show up quickly (scans are incremental, so a tight cadence is cheap).
 */
export interface ScanSchedule {
  mode: 'off' | 'every' | 'interval' | 'daily' | 'weekly';
  /** Local server time, "HH:MM" 24h. */
  time: string;
  /** 0 = Sunday … 6 = Saturday; only meaningful for weekly. */
  weekday: number;
  /** Minutes between rescans; only meaningful for 'every'. */
  everyMinutes?: number;
}

/** Floor for the 'every' cadence — protects the NAS from a hammering walk. */
export const MIN_SCAN_EVERY_MINUTES = 5;

/** Settings-store key holding the schedule. */
export const SCAN_SCHEDULE_KEY = 'library.scanSchedule';

/** Settings-store key holding the last scheduled trigger time. */
export const SCAN_LAST_RUN_KEY = 'library.lastScheduledScanAt';

function atTime(base: Date, time: string): Date {
  const [hours, minutes] = time.split(':').map(Number);
  const result = new Date(base);
  result.setHours(hours, minutes, 0, 0);
  return result;
}

/** The most recent time the schedule should have fired, at or before now. */
export function mostRecentOccurrence(schedule: ScanSchedule, now: Date): Date | null {
  if (schedule.mode === 'daily') {
    const today = atTime(now, schedule.time);
    if (today.getTime() <= now.getTime()) {
      return today;
    }
    return new Date(today.getTime() - 24 * 60 * 60 * 1000);
  }
  if (schedule.mode === 'weekly') {
    const candidate = atTime(now, schedule.time);
    const dayDelta = (candidate.getDay() - schedule.weekday + 7) % 7;
    candidate.setDate(candidate.getDate() - dayDelta);
    if (candidate.getTime() <= now.getTime()) {
      return candidate;
    }
    return new Date(candidate.getTime() - 7 * 24 * 60 * 60 * 1000);
  }
  return null;
}

/** The next time the schedule will fire, strictly after now. */
export function nextOccurrence(schedule: ScanSchedule, now: Date): Date | null {
  const previous = mostRecentOccurrence(schedule, now);
  if (previous === null) {
    return null;
  }
  const periodMs = (schedule.mode === 'weekly' ? 7 : 1) * 24 * 60 * 60 * 1000;
  return new Date(previous.getTime() + periodMs);
}
