CREATE TABLE "event_cluster" (
	"id" uuid PRIMARY KEY NOT NULL,
	"algo_version" integer NOT NULL,
	"status" text DEFAULT 'suggested' NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"seed_title" text NOT NULL,
	"score" real NOT NULL,
	"signals" jsonb,
	"member_signature" text NOT NULL,
	"accepted_memory_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_cluster_status_check" CHECK ("event_cluster"."status" in ('suggested', 'accepted', 'dismissed', 'superseded'))
);
--> statement-breakpoint
CREATE TABLE "event_cluster_asset" (
	"cluster_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	CONSTRAINT "event_cluster_asset_cluster_id_asset_id_pk" PRIMARY KEY("cluster_id","asset_id")
);
--> statement-breakpoint
CREATE TABLE "journal_entry" (
	"id" uuid PRIMARY KEY NOT NULL,
	"memory_id" uuid NOT NULL,
	"author_user_id" uuid NOT NULL,
	"body_md" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memory" (
	"id" uuid PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"date_precision" text DEFAULT 'exact' NOT NULL,
	"cover_asset_id" uuid,
	"location_label" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	CONSTRAINT "memory_date_precision_check" CHECK ("memory"."date_precision" in ('exact', 'day', 'month', 'year', 'approx'))
);
--> statement-breakpoint
CREATE TABLE "memory_asset" (
	"memory_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"added_by" uuid,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memory_asset_memory_id_asset_id_pk" PRIMARY KEY("memory_id","asset_id")
);
--> statement-breakpoint
ALTER TABLE "event_cluster_asset" ADD CONSTRAINT "event_cluster_asset_cluster_id_event_cluster_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."event_cluster"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_cluster_asset" ADD CONSTRAINT "event_cluster_asset_asset_id_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."asset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entry" ADD CONSTRAINT "journal_entry_memory_id_memory_id_fk" FOREIGN KEY ("memory_id") REFERENCES "public"."memory"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entry" ADD CONSTRAINT "journal_entry_author_user_id_user_account_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."user_account"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory" ADD CONSTRAINT "memory_cover_asset_id_asset_id_fk" FOREIGN KEY ("cover_asset_id") REFERENCES "public"."asset"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory" ADD CONSTRAINT "memory_created_by_user_account_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user_account"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory" ADD CONSTRAINT "memory_deleted_by_user_account_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."user_account"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_asset" ADD CONSTRAINT "memory_asset_memory_id_memory_id_fk" FOREIGN KEY ("memory_id") REFERENCES "public"."memory"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_asset" ADD CONSTRAINT "memory_asset_asset_id_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."asset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_asset" ADD CONSTRAINT "memory_asset_added_by_user_account_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."user_account"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_cluster_status_idx" ON "event_cluster" USING btree ("status","score");--> statement-breakpoint
CREATE INDEX "event_cluster_signature_idx" ON "event_cluster" USING btree ("member_signature");--> statement-breakpoint
CREATE INDEX "event_cluster_asset_asset_idx" ON "event_cluster_asset" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "journal_entry_memory_idx" ON "journal_entry" USING btree ("memory_id");--> statement-breakpoint
CREATE INDEX "memory_timeline_idx" ON "memory" USING btree ("start_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "memory_asset_asset_idx" ON "memory_asset" USING btree ("asset_id");