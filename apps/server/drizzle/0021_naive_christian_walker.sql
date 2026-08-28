CREATE TABLE "cleanup_dismissal" (
	"asset_id" uuid PRIMARY KEY NOT NULL,
	"dismissed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cleanup_dismissal" ADD CONSTRAINT "cleanup_dismissal_asset_id_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."asset"("id") ON DELETE cascade ON UPDATE no action;