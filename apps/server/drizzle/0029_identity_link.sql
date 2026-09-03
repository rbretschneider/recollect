CREATE TABLE "identity_link" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"issuer" text NOT NULL,
	"subject" text NOT NULL,
	"email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "identity_link" ADD CONSTRAINT "identity_link_user_id_user_account_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "identity_link_issuer_subject_unique" ON "identity_link" USING btree ("issuer","subject");--> statement-breakpoint
CREATE INDEX "identity_link_user_id_idx" ON "identity_link" USING btree ("user_id");
