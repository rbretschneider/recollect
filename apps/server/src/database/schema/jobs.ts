import { sql } from 'drizzle-orm';
import {
  check,
  index,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/** DB-backed job queue; claimed with FOR UPDATE SKIP LOCKED by bounded workers. */
export const job = pgTable(
  'job',
  {
    id: uuid('id').primaryKey(),
    type: text('type').notNull(),
    payload: jsonb('payload').notNull(),
    /** Prevents duplicate enqueues of the same unit of work, e.g. `ingest_file:<rootId>:<relPath>`. */
    dedupeKey: text('dedupe_key'),
    priority: smallint('priority').notNull().default(100),
    status: text('status').notNull().default('queued'),
    attempts: smallint('attempts').notNull().default(0),
    maxAttempts: smallint('max_attempts').notNull().default(3),
    runAt: timestamp('run_at', { withTimezone: true }).notNull().defaultNow(),
    workerId: text('worker_id'),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (table) => [
    // Only live rows are ever claimed. Covering finished jobs too made this
    // 59MB against 1.3M dead rows and re-indexed every job that completed.
    index('job_claim_idx')
      .on(table.status, table.runAt, table.priority)
      .where(sql`${table.status} in ('queued', 'running')`),
    // Retention sweeps by age over finished rows; without this each nightly
    // batch seq-scanned the whole table.
    index('job_retention_idx')
      .on(sql`coalesce(${table.finishedAt}, ${table.createdAt})`)
      .where(sql`${table.status} in ('done', 'failed')`),
    // Dedupe applies only to live jobs; finished work may be enqueued again.
    uniqueIndex('job_dedupe_live_unique')
      .on(table.dedupeKey)
      .where(sql`${table.status} in ('queued', 'running')`),
    check(
      'job_status_check',
      sql`${table.status} in ('queued', 'running', 'done', 'failed', 'cancelled')`,
    ),
  ],
);
