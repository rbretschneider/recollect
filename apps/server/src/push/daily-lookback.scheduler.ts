import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { DashboardService } from '../dashboard/dashboard.service';
import { PushService } from './push.service';

const CHECK_EVERY_MS = 5 * 60 * 1000;
/** Only fire within this many minutes past the target, so a late boot doesn't
 * buzz someone at an odd hour — they just get it the next morning instead. */
const WINDOW_MINUTES = 180;
/**
 * Same cap as the look-back page, so "is today different?" is judged on what
 * the person will actually see when they tap through - not a shorter list
 * that the same few big clusters can dominate for a week.
 */
const LOOKBACK_LIMIT = 12;

/**
 * Sends the daily "this week, years ago" push at each user's own local time.
 * Web Push is server-initiated, so we can't lean on the device's clock — every
 * few minutes we check who has crossed their chosen time in their own zone,
 * and only buzz them when there's actually something to look back on.
 */
@Injectable()
export class DailyLookbackScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(DailyLookbackScheduler.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly push: PushService,
    private readonly dashboard: DashboardService,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => void this.tick(), CHECK_EVERY_MS);
  }

  onApplicationShutdown(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async tick(): Promise<void> {
    if (!this.push.isEnabled) {
      return; // No VAPID keys — push is off.
    }
    let candidates: Awaited<ReturnType<PushService['dailyCandidates']>>;
    try {
      candidates = await this.push.dailyCandidates();
    } catch (error) {
      this.logger.warn(`Daily look-back check failed: ${(error as Error).message}`);
      return;
    }
    const now = new Date();
    for (const candidate of candidates) {
      try {
        const local = localParts(now, candidate.timezone);
        const target = parseHhmm(candidate.dailyTime);
        if (target === null || local.minutes < target || local.minutes > target + WINDOW_MINUTES) {
          continue; // Not their moment yet (or the window has passed).
        }
        if (candidate.lastSentOn === local.date) {
          continue; // Already handled today.
        }
        // Claim the day up front so a slow content check can't double-send on
        // the next tick — a no-content day is still "handled".
        await this.push.markDailySent(candidate.userId, local.date);
        const moments = await this.dashboard.onThisDayMoments(local.mmdd, local.year, LOOKBACK_LIMIT);
        if (moments.length === 0) {
          this.logger.log(`Daily look-back for ${candidate.userId}: skipped, nothing to relive.`);
          continue;
        }
        // The window slides a day at a time, so the page almost always changes
        // a little. Stay quiet only when it is exactly what they were sent last
        // time - the old "nothing new in the top few" test let one big cluster
        // silence a week of mornings.
        const keys = moments.map((moment) => moment.key).sort().join(',');
        if (keys === candidate.lastMomentKeys) {
          this.logger.log(`Daily look-back for ${candidate.userId}: skipped, identical to last push.`);
          continue;
        }
        const count = moments.length;
        const delivered = await this.push.sendToUser(candidate.userId, {
          title: 'This week, years ago 📸',
          body: `${count} ${count === 1 ? 'moment' : 'moments'} from years past — tap to look back.`,
          url: '/lookback',
        });
        await this.push.recordDailyPush(candidate.userId, keys);
        this.logger.log(
          `Daily look-back for ${candidate.userId}: sent ${count} moments to ${delivered} device(s).`,
        );
      } catch (error) {
        this.logger.warn(`Daily look-back for ${candidate.userId} failed: ${(error as Error).message}`);
      }
    }
  }
}

/** "HH:MM" → minutes past midnight, or null if malformed. */
function parseHhmm(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }
  return Number(match[1]) * 60 + Number(match[2]);
}

/** Local date/MM-DD/minutes/year for a wall clock in the given IANA zone. */
function localParts(
  now: Date,
  timeZone: string,
): { date: string; mmdd: string; minutes: number; year: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const get = (type: string): string => parts.find((part) => part.type === type)?.value ?? '';
  const month = get('month');
  const day = get('day');
  let hour = get('hour');
  if (hour === '24') {
    hour = '00'; // Some environments render midnight as 24.
  }
  return {
    date: `${get('year')}-${month}-${day}`,
    mmdd: `${month}-${day}`,
    minutes: Number(hour) * 60 + Number(get('minute')),
    year: Number(get('year')),
  };
}
