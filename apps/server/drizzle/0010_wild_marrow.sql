ALTER TABLE "asset" ADD COLUMN "geocode_cell_key" text GENERATED ALWAYS AS (case when gps_lat is null or gps_lon is null then null else round(gps_lat::numeric, 2)::text || ',' || round(gps_lon::numeric, 2)::text end) STORED;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "asset_timeline_active_idx" ON "asset" ("captured_at" DESC, "id" DESC) WHERE status = 'active';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "asset_trashed_idx" ON "asset" ("trashed_at") WHERE status = 'trashed';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "asset_file_asset_present_idx" ON "asset_file" ("asset_id") INCLUDE ("rel_path", "size_bytes", "root_id") WHERE state = 'present';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "asset_file_asset_trashed_idx" ON "asset_file" ("asset_id") WHERE state = 'trashed';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "asset_file_root_relpath_pattern_idx" ON "asset_file" ("root_id", "rel_path" text_pattern_ops) WHERE state = 'present';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "asset_file_relpath_trgm_idx" ON "asset_file" USING gin ("rel_path" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memory_title_trgm_idx" ON "memory" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memory_description_trgm_idx" ON "memory" USING gin ("description" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memory_location_trgm_idx" ON "memory" USING gin ("location_label" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "journal_body_trgm_idx" ON "journal_entry" USING gin ("body_md" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "album_title_trgm_idx" ON "album" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "face_person_quality_idx" ON "face" ("person_id", "quality" DESC) WHERE ignored = false;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "person_visible_idx" ON "person" ("id") WHERE merged_into_id IS NULL AND hidden = false;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_cluster_suggested_start_idx" ON "event_cluster" ("start_at" DESC) WHERE status = 'suggested';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memory_live_timeline_idx" ON "memory" ("start_at" DESC) WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "album_live_updated_idx" ON "album" ("updated_at" DESC) WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "asset_geocode_cell_idx" ON "asset" ("geocode_cell_key") WHERE geocode_cell_key IS NOT NULL;
