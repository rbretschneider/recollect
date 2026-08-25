CREATE TABLE "app_setting" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"refresh_token_hash" text NOT NULL,
	"device_label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "user_account" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"password_hash" text NOT NULL,
	"permission" text DEFAULT 'read' NOT NULL,
	"is_admin" boolean DEFAULT false NOT NULL,
	"must_change_password" boolean DEFAULT false NOT NULL,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_account_permission_check" CHECK ("user_account"."permission" in ('read', 'write', 'delete'))
);
--> statement-breakpoint
CREATE TABLE "job" (
	"id" uuid PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"dedupe_key" text,
	"priority" smallint DEFAULT 100 NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"max_attempts" smallint DEFAULT 3 NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"worker_id" text,
	"lease_expires_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "job_dedupe_key_unique" UNIQUE("dedupe_key"),
	CONSTRAINT "job_status_check" CHECK ("job"."status" in ('queued', 'running', 'done', 'failed', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "asset" (
	"id" uuid PRIMARY KEY NOT NULL,
	"content_hash" text NOT NULL,
	"media_type" text NOT NULL,
	"mime" text NOT NULL,
	"width" integer,
	"height" integer,
	"duration_ms" integer,
	"orientation" smallint,
	"captured_at" timestamp with time zone NOT NULL,
	"captured_tz_offset_min" smallint,
	"captured_at_source" text NOT NULL,
	"captured_day" date NOT NULL,
	"gps_lat" double precision,
	"gps_lon" double precision,
	"gps_alt_m" real,
	"camera_make" text,
	"camera_model" text,
	"lens_model" text,
	"status" text DEFAULT 'active' NOT NULL,
	"trashed_at" timestamp with time zone,
	"trashed_by" uuid,
	"stage_metadata_at" timestamp with time zone,
	"stage_thumbs_at" timestamp with time zone,
	"stage_errors" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asset_content_hash_unique" UNIQUE("content_hash"),
	CONSTRAINT "asset_media_type_check" CHECK ("asset"."media_type" in ('image', 'video')),
	CONSTRAINT "asset_captured_at_source_check" CHECK ("asset"."captured_at_source" in ('exif', 'filename', 'file_mtime', 'user')),
	CONSTRAINT "asset_status_check" CHECK ("asset"."status" in ('active', 'missing', 'trashed'))
);
--> statement-breakpoint
CREATE TABLE "asset_file" (
	"id" uuid PRIMARY KEY NOT NULL,
	"asset_id" uuid NOT NULL,
	"root_id" uuid NOT NULL,
	"rel_path" text NOT NULL,
	"file_name" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"fs_mtime" timestamp with time zone NOT NULL,
	"state" text DEFAULT 'present' NOT NULL,
	"trash_path" text,
	"original_rel_path" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_verified_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asset_file_state_check" CHECK ("asset_file"."state" in ('present', 'missing', 'trashed'))
);
--> statement-breakpoint
CREATE TABLE "asset_metadata" (
	"asset_id" uuid PRIMARY KEY NOT NULL,
	"raw" jsonb NOT NULL,
	"extracted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "library_root" (
	"id" uuid PRIMARY KEY NOT NULL,
	"path" text NOT NULL,
	"name" text NOT NULL,
	"exclude_globs" text[] DEFAULT '{}' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_scan_started_at" timestamp with time zone,
	"last_scan_completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "library_root_path_unique" UNIQUE("path")
);
--> statement-breakpoint
ALTER TABLE "app_setting" ADD CONSTRAINT "app_setting_updated_by_user_account_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user_account"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_user_account_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user_account"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_account_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset" ADD CONSTRAINT "asset_trashed_by_user_account_id_fk" FOREIGN KEY ("trashed_by") REFERENCES "public"."user_account"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_file" ADD CONSTRAINT "asset_file_asset_id_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."asset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_file" ADD CONSTRAINT "asset_file_root_id_library_root_id_fk" FOREIGN KEY ("root_id") REFERENCES "public"."library_root"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_metadata" ADD CONSTRAINT "asset_metadata_asset_id_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."asset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_created_at_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "session_user_id_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_account_email_unique" ON "user_account" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "job_claim_idx" ON "job" USING btree ("status","run_at","priority");--> statement-breakpoint
CREATE INDEX "asset_timeline_idx" ON "asset" USING btree ("captured_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "asset_captured_day_idx" ON "asset" USING btree ("captured_day");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_file_root_path_unique" ON "asset_file" USING btree ("root_id","rel_path");--> statement-breakpoint
CREATE INDEX "asset_file_asset_id_idx" ON "asset_file" USING btree ("asset_id");