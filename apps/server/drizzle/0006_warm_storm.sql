CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE TABLE "asset_embedding" (
	"asset_id" uuid NOT NULL,
	"model" text NOT NULL,
	"embedding" vector(768) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asset_embedding_asset_id_model_pk" PRIMARY KEY("asset_id","model")
);
--> statement-breakpoint
CREATE TABLE "face" (
	"id" uuid PRIMARY KEY NOT NULL,
	"asset_id" uuid NOT NULL,
	"person_id" uuid,
	"assignment" text DEFAULT 'auto' NOT NULL,
	"bbox" real[] NOT NULL,
	"quality" real NOT NULL,
	"ignored" boolean DEFAULT false NOT NULL,
	"embedding" vector(512) NOT NULL,
	"embed_model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "face_assignment_check" CHECK ("face"."assignment" in ('auto', 'user'))
);
--> statement-breakpoint
CREATE TABLE "person" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text,
	"cover_face_id" uuid,
	"hidden" boolean DEFAULT false NOT NULL,
	"merged_into_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "asset" ADD COLUMN "stage_faces_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "asset" ADD COLUMN "stage_embed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "asset_embedding" ADD CONSTRAINT "asset_embedding_asset_id_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."asset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "face" ADD CONSTRAINT "face_asset_id_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."asset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "face" ADD CONSTRAINT "face_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "face_asset_idx" ON "face" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "face_person_idx" ON "face" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "person_merged_idx" ON "person" USING btree ("merged_into_id");
--> statement-breakpoint
CREATE INDEX "face_embedding_hnsw" ON "face" USING hnsw ("embedding" vector_cosine_ops);
--> statement-breakpoint
CREATE INDEX "asset_embedding_hnsw" ON "asset_embedding" USING hnsw ("embedding" vector_cosine_ops);
