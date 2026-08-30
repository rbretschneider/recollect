CREATE TABLE IF NOT EXISTS "notification_pref" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"daily_enabled" boolean DEFAULT true NOT NULL,
	"daily_time" text DEFAULT '07:30' NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"last_sent_on" date,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
