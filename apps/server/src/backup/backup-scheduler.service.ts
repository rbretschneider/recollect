import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { JobQueueService } from '../jobs/job-queue.service';
import { mostRecentOccurrence } from '../library/scan-schedule';
import { BACKUP_DATABASE_JOB, BackupService } from './backup.service';

const CHECK_EVERY_MS = 60 * 1000;

/**
 * Fires the scheduled database backup. Mirrors the library scan scheduler: a
 * minute tick compares "now" against the configured daily/weekly moment, and a
 * boot check covers a server that was asleep when its moment passed.
 */
@Injectable()
export class BackupSchedulerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(BackupSchedulerService.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly backup: BackupService,
    private readonly queue: JobQueueService,
  ) {}

  onApplicationBootstrap(): void {
    void this.tick();
    this.timer = setInterval(() => void this.tick(), CHECK_EVERY_MS);
  }

  onApplicationShutdown(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async tick(): Promise<void> {
    try {
      const settings = await this.backup.getSettings();
      if (settings.mode === 'off') {
        return;
      }
      const due = mostRecentOccurrence(
        { mode: settings.mode, time: settings.time, weekday: settings.weekday },
        new Date(),
      );
      if (!due) {
        return;
      }
      // Already covered: the last run happened at or after this occurrence.
      const lastRun = await this.backup.getLastRun();
      if (lastRun && new Date(lastRun.at).getTime() >= due.getTime()) {
        return;
      }
      await this.queue.enqueue(
        BACKUP_DATABASE_JOB,
        { scheduled: true },
        { dedupeKey: BACKUP_DATABASE_JOB, priority: 220 },
      );
      this.logger.log(`Scheduled ${settings.mode} backup queued.`);
    } catch (error) {
      this.logger.warn(`Backup schedule check failed: ${(error as Error).message}`);
    }
  }
}
