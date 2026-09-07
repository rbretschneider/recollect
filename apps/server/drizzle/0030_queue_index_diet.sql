-- Queue and timeline index tuning.
--
-- Measured on the live library (1.3M job rows, 450MB): the queue's own indexes
-- were sized for the whole table when only the live rows are ever claimed, and
-- the timeline carried two indexes where one was doing all the work.

-- The timeline only ever reads active assets, and asset_timeline_active_idx
-- already serves it as an index-only scan (0.15ms for a 100-row page). This
-- unpartitioned twin had taken 17 scans in the table's lifetime: pure write cost.
DROP INDEX IF EXISTS "asset_timeline_idx";--> statement-breakpoint

-- Claiming only ever looks at queued/running rows, but the index covered all
-- 1.3M finished ones too - 59MB, and write amplification on every job that
-- completes. Partial, it is a few hundred kB.
DROP INDEX IF EXISTS "job_claim_idx";--> statement-breakpoint
CREATE INDEX "job_claim_idx" ON "job" USING btree ("status","run_at","priority")
  WHERE "status" IN ('queued', 'running');--> statement-breakpoint

-- History pruning had no index at all: each nightly batch seq-scanned the table
-- (152ms, ~800k rows read per 20k deleted, up to 200 batches a night). The
-- expression matches JobRetentionService's predicate exactly so it can be used.
CREATE INDEX "job_retention_idx" ON "job" USING btree ((COALESCE("finished_at", "created_at")))
  WHERE "status" IN ('done', 'failed');
