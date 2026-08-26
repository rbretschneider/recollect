import { Inject, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { DATABASE } from '../database/database.module';
import type { Database } from '../database/database.module';
import { job } from '../database/schema';

/** A claimed job ready for execution. */
export interface ClaimedJob {
  id: string;
  type: string;
  payload: unknown;
  attempts: number;
  maxAttempts: number;
}

/** Options for enqueueing a job. */
export interface EnqueueOptions {
  /** Deduplicates concurrent enqueues of the same unit of work. */
  dedupeKey?: string;
  /** Lower runs sooner. User-visible work should outrank background ML. */
  priority?: number;
  /** Earliest execution time — a dedupe key plus a delay debounces bursts. */
  runAt?: Date;
  maxAttempts?: number;
}

const DEFAULT_PRIORITY = 100;
const DEFAULT_MAX_ATTEMPTS = 3;
const RETRY_BACKOFF_BASE_SECONDS = 30;
const WORKER_LEASE_MINUTES = 10;

/** DB-backed job queue: enqueue with dedupe, claim with SKIP LOCKED, retry with backoff. */
@Injectable()
export class JobQueueService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** Enqueues a job; silently no-ops when an identical dedupeKey is already queued or running. */
  async enqueue(type: string, payload: unknown, options: EnqueueOptions = {}): Promise<void> {
    await this.db
      .insert(job)
      .values({
        id: uuidv7(),
        type,
        payload,
        dedupeKey: options.dedupeKey ?? null,
        priority: options.priority ?? DEFAULT_PRIORITY,
        runAt: options.runAt ?? new Date(),
        maxAttempts: options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
      })
      .onConflictDoUpdate({
        target: job.dedupeKey,
        targetWhere: sql`status in ('queued', 'running')`,
        // A duplicate enqueue never duplicates work, but an urgent request
        // (e.g. a user opening a video queued for background transcode)
        // upgrades the waiting job's priority and runs it sooner.
        set: {
          priority: sql`least(${job.priority}, excluded.priority)`,
          runAt: sql`least(${job.runAt}, excluded.run_at)`,
        },
      });
  }

  /** Atomically claims the next runnable job for a worker, or returns null when idle. */
  async claim(workerId: string): Promise<ClaimedJob | null> {
    const rows = await this.db.execute(sql`
      UPDATE job SET
        status = 'running',
        worker_id = ${workerId},
        started_at = now(),
        attempts = attempts + 1,
        lease_expires_at = now() + interval '${sql.raw(String(WORKER_LEASE_MINUTES))} minutes'
      WHERE id = (
        SELECT id FROM job
        WHERE (status = 'queued' AND run_at <= now())
           OR (status = 'running' AND lease_expires_at < now())
        ORDER BY priority, run_at
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      RETURNING id, type, payload, attempts, max_attempts
    `);
    const row = rows.rows[0] as
      | { id: string; type: string; payload: unknown; attempts: number; max_attempts: number }
      | undefined;
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      type: row.type,
      payload: row.payload,
      attempts: row.attempts,
      maxAttempts: row.max_attempts,
    };
  }

  async complete(jobId: string): Promise<void> {
    await this.db
      .update(job)
      .set({ status: 'done', finishedAt: new Date(), error: null })
      .where(eq(job.id, jobId));
  }

  /** Marks a job failed; requeues with quadratic backoff until attempts are exhausted. */
  async fail(claimed: ClaimedJob, error: Error): Promise<void> {
    const isExhausted = claimed.attempts >= claimed.maxAttempts;
    if (isExhausted) {
      await this.db
        .update(job)
        .set({ status: 'failed', finishedAt: new Date(), error: error.message })
        .where(eq(job.id, claimed.id));
      return;
    }
    const backoffSeconds = RETRY_BACKOFF_BASE_SECONDS * claimed.attempts ** 2;
    await this.db
      .update(job)
      .set({
        status: 'queued',
        error: error.message,
        runAt: new Date(Date.now() + backoffSeconds * 1000),
        workerId: null,
        leaseExpiresAt: null,
      })
      .where(eq(job.id, claimed.id));
  }
}
