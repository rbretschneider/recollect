CREATE TABLE "memory_quote" (
	"id" uuid PRIMARY KEY NOT NULL,
	"memory_id" uuid NOT NULL,
	"text" text NOT NULL,
	"said_by" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "memory_quote" ADD CONSTRAINT "memory_quote_memory_id_memory_id_fk" FOREIGN KEY ("memory_id") REFERENCES "public"."memory"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_quote" ADD CONSTRAINT "memory_quote_created_by_user_account_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user_account"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "memory_quote_memory_idx" ON "memory_quote" USING btree ("memory_id");