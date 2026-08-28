CREATE TABLE "contribution_link" (
	"id" uuid PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"album_id" uuid NOT NULL,
	"pool_view" boolean DEFAULT true NOT NULL,
	"created_by" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"upload_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contribution_link_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "guest_upload" (
	"id" uuid PRIMARY KEY NOT NULL,
	"link_id" uuid NOT NULL,
	"album_id" uuid NOT NULL,
	"uploader_name" text NOT NULL,
	"original_filename" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"mime" text NOT NULL,
	"media_type" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"asset_id" uuid,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guest_upload_status_check" CHECK ("guest_upload"."status" in ('pending', 'approved', 'rejected')),
	CONSTRAINT "guest_upload_media_type_check" CHECK ("guest_upload"."media_type" in ('image', 'video'))
);
--> statement-breakpoint
ALTER TABLE "contribution_link" ADD CONSTRAINT "contribution_link_album_id_album_id_fk" FOREIGN KEY ("album_id") REFERENCES "public"."album"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contribution_link" ADD CONSTRAINT "contribution_link_created_by_user_account_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_upload" ADD CONSTRAINT "guest_upload_link_id_contribution_link_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."contribution_link"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_upload" ADD CONSTRAINT "guest_upload_album_id_album_id_fk" FOREIGN KEY ("album_id") REFERENCES "public"."album"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_upload" ADD CONSTRAINT "guest_upload_asset_id_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."asset"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contribution_link_album_idx" ON "contribution_link" USING btree ("album_id");--> statement-breakpoint
CREATE INDEX "guest_upload_album_status_idx" ON "guest_upload" USING btree ("album_id","status");