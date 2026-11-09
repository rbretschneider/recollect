CREATE TABLE "asset_caption" (
  "id" uuid PRIMARY KEY NOT NULL,
  "asset_id" uuid NOT NULL REFERENCES "asset"("id") ON DELETE CASCADE,
  "text" text NOT NULL,
  "said_by_person_id" uuid REFERENCES "person"("id") ON DELETE SET NULL,
  "said_by_label" text,
  "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "asset_caption_text_check" CHECK (char_length("text") between 1 and 500),
  CONSTRAINT "asset_caption_label_check" CHECK ("said_by_label" is null or length(btrim("said_by_label")) > 0),
  CONSTRAINT "asset_caption_person_label_check" CHECK ("said_by_person_id" is null or "said_by_label" is not null)
);
--> statement-breakpoint
CREATE INDEX "asset_caption_asset_order_idx" ON "asset_caption" ("asset_id", "created_at", "id");
--> statement-breakpoint
CREATE INDEX "asset_caption_person_idx" ON "asset_caption" ("said_by_person_id");
