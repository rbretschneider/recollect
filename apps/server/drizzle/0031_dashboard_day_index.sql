-- "On this day" was the most expensive read on the landing page.
--
-- It selected the surrounding week with `to_char(captured_day, 'MM-DD') = any(...)`.
-- Wrapping the column in a function makes asset_captured_day_idx unusable, so
-- the planner walked the whole timeline instead: measured at 19,547 buffers and
-- 28,231 rows discarded to find 349 - work that grows with the library on every
-- dashboard load. to_char() cannot be indexed at all (it depends on the server's
-- locale, so Postgres will not treat it as immutable), so the query now matches
-- the day as a number and this indexes exactly that expression.
CREATE INDEX "asset_day_of_year_idx" ON "asset"
  (((extract(month from "captured_day") * 100 + extract(day from "captured_day"))::int))
  WHERE "status" = 'active';--> statement-breakpoint

-- Expression indexes carry no statistics until the table is analyzed, and
-- without them the planner keeps its old plan. The same applies to
-- job_retention_idx from 0030: it was still choosing a 254ms seq scan for the
-- nightly sweep until this ran, then used the index and took 7ms.
ANALYZE "asset";--> statement-breakpoint
ANALYZE "job";
