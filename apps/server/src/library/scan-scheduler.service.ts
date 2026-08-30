import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { APP_CONFIG } from '../config/app-config';
import type { AppConfig } from '../config/app-config';
import { DATABASE } from '../database/database.module';
import type { Database } from '../database/database.module';
import { libraryRoot } from '../database/schema';
import { LibraryService } from './library.service';
import {
  MIN_SCAN_EVERY_MINUTES,
  mostRecentOccurrence,
  SCAN_LAST_RUN_KEY,
  SCAN_SCHEDULE_KEY,
  ScanSchedule,
} from './scan-schedule';

const CHECK_EVERY_MS = 60 * 1000;
const MILLISECONDS_PER_HOUR = 60 * 60 * 1000;

/**
 * Scheduled rescans (FRD story S2.3): new files dropped onto the NAS appear
 * without user action. The Library page picks the mode: off, a fixed daily or
 * weekly time (server-local), or the legacy default — every SCAN_INTERVAL_HOURS
 * (24h). A boot check covers servers asleep when their moment passed.
 */
@Injectable()
export class ScanSchedulerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(ScanSchedulerService.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly library: LibraryService,
  ) {}

  onApplicationBootstrap(): void {
    void this.enqueueDueScans();
    this.timer = setInterval(() => void this.enqueueDueScans(), CHECK_EVERY_MS);
  }

  onApplicationShutdown(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async enqueueDueScans(): Promise<void> {
    try {
      const schedule = (await this.library.getSetting<ScanSchedule>(SCAN_SCHEDULE_KEY)) ?? {
        mode: 'interval' as const,
        time: '03:00',
        weekday: 0,
      };
      if (schedule.mode === 'off') {
        return;
      }
      if (schedule.mode === 'interval') {
        await this.enqueueDueRootScans(this.config.scanIntervalHours * MILLISECONDS_PER_HOUR);
        return;
      }
      if (schedule.mode === 'every') {
        const minutes = Math.max(MIN_SCAN_EVERY_MINUTES, schedule.everyMinutes ?? 15);
        await this.enqueueDueRootScans(minutes * 60 * 1000);
        return;
      }
      const due = mostRecentOccurrence(schedule, new Date());
      if (!due) {
        return;
      }
      const lastRun = await this.library.getSetting<string>(SCAN_LAST_RUN_KEY);
      if (lastRun && new Date(lastRun).getTime() >= due.getTime()) {
        return; // This occurrence already fired.
      }
      await this.library.setSetting(SCAN_LAST_RUN_KEY, new Date().toISOString());
      const scanned = await this.scanAllEnabledRoots();
      this.logger.log(`Scheduled ${schedule.mode} scan fired for ${scanned} roots.`);
    } catch (error) {
      this.logger.error(`Scheduled scan check failed: ${(error as Error).message}`);
    }
  }

  /**
   * Enqueues a scan for each enabled root whose last scan is older than
   * maxAgeMs. Drives both the legacy hourly interval and the minutes-cadence
   * 'every' mode; keying off each root's lastScanStartedAt means a scan already
   * running (or just run) is never doubled up, so a tight cadence is safe.
   */
  private async enqueueDueRootScans(maxAgeMs: number): Promise<void> {
    const cutoff = Date.now() - maxAgeMs;
    const roots = await this.db
      .select({ id: libraryRoot.id, lastScanStartedAt: libraryRoot.lastScanStartedAt })
      .from(libraryRoot)
      .where(eq(libraryRoot.enabled, true));
    for (const root of roots) {
      const isDue = !root.lastScanStartedAt || root.lastScanStartedAt.getTime() < cutoff;
      if (isDue) {
        await this.library.enqueueScan(root.id);
      }
    }
  }

  private async scanAllEnabledRoots(): Promise<number> {
    const roots = await this.db
      .select({ id: libraryRoot.id })
      .from(libraryRoot)
      .where(eq(libraryRoot.enabled, true));
    for (const root of roots) {
      await this.library.enqueueScan(root.id);
    }
    return roots.length;
  }
}
