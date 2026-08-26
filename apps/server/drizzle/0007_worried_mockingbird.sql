CREATE TABLE "device_owner" (
	"id" uuid PRIMARY KEY NOT NULL,
	"camera_make" text DEFAULT '' NOT NULL,
	"camera_model" text DEFAULT '' NOT NULL,
	"owner_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "device_owner_device_idx" ON "device_owner" USING btree ("camera_make","camera_model");