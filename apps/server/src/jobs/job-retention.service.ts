import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { APP_CONFIG } from '../config/app-config';
import type { AppConfig } from '../config/app-config';
import { DATABASE } from '../database/database.module';
import type { Database } from '../database/database.module';

/** Sweep once a day; the backlog is never urgent. */
const SWEEP_EVERY_MS = 24 * 60 * 60_000;
/** Wait for the queue to settle after boot before touching it. */
const FIRST_SWEEP_DELAY_MS = 5 * 60_000;
/**
 * Rows per statement. A first sweep can face millions of rows, and one delete
 * that size holds a long transaction and balloons WAL — small batches keep each
 * statement short and let the queue keep working between them.
 */
const BATCH_SIZE = 20_000;
/** Stop after this many batches in one sweep; the rest waits for tomorrow. */
const MAX_BATCHES_PER_SWEEP = 200;

/**
 * Deletes finished jobs once they're older than the retention window.
 *
 * The queue table is append-only in practice: every scan, ingest, thumbnail and
 * transcode leaves a completed row behind forever. On a real library that
 * reaches millions of rows and hundreds of megabytes — dead weight in every
 * backup, and slower scans for the queue itself. Recent history is genuinely
 * useful for debugging a failed import, so keep a window and drop the rest.
 */
@Injectable()
export class JobRetentionService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(JobRetentionService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private firstSweep: ReturnType<typeof setTimeout> | null = null;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.jobRetentionDays <= 0) {
      this.logger.log('Job history pruning is disabled (JOB_RETENTION_DAYS=0).');
      return;
    }
    this.firstSweep = setTimeout(() => void this.sweep(), FIRST_SWEEP_DELAY_MS);
    this.timer = setInterval(() => void this.sweep(), SWEEP_EVERY_MS);
  }

  onApplicationShutdown(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.firstSweep !== null) {
      clearTimeout(this.firstSweep);
      this.firstSweep = null;
    }
  }

  /** Deletes aged-out finished jobs in batches. Returns how many went. */
  async sweep(): Promise<number> {
    const days = this.config.jobRetentionDays;
    if (days <= 0) {
      return 0;
    }
    let removed = 0;
    try {
      for (let batch = 0; batch < MAX_BATCHES_PER_SWEEP; batch++) {
        const result = await this.db.execute<{ id: string }>(sql`
          delete from job
          where id in (
            select id from job
            where status in ('done', 'failed')
              and coalesce(finished_at, created_at) < now() - make_interval(days => ${days})
            limit ${BATCH_SIZE}
          )
          returning id
        `);
        removed += result.rows.length;
        if (result.rows.length < BATCH_SIZE) {
          break; // Caught up.
        }
      }
      if (removed > 0) {
        this.logger.log(`Pruned ${removed} finished jobs older than ${days} days.`);
      }
    } catch (error) {
      this.logger.warn(`Job history sweep failed: ${(error as Error).message}`);
    }
    return removed;
  }
}
