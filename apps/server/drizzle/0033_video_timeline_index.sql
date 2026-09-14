-- The Media page can now show videos alone. Videos are a small slice of the
-- library, so a videos-only page walked asset_timeline_active_idx discarding
-- every photo in between until it had filled a page - the further back you
-- scroll, the more it skips. A partial index over just the active videos keeps
-- that scroll as cheap as the mixed one. Photos-only needs no index of its
-- own: nearly every row already matches, so the existing timeline index is
-- the right plan.
CREATE INDEX IF NOT EXISTS "asset_video_timeline_idx" ON "asset" ("captured_at" DESC, "id" DESC)
  WHERE "status" = 'active' AND "media_type" = 'video';--> statement-breakpoint
ANALYZE "asset";
