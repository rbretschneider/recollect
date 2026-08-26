import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uuid,
  vector,
} from 'drizzle-orm/pg-core';
import { asset } from './library';

/**
 * Someone appearing in photos. An unnamed face cluster IS a person row with
 * name = NULL (data-model.md §1.3); naming it is an UPDATE, merging is a
 * repoint + tombstone. A Person is not an app user.
 */
export const person = pgTable(
  'person',
  {
    id: uuid('id').primaryKey(),
    name: text('name'),
    /** A face id chosen as the avatar; plain uuid to avoid a circular FK. */
    coverFaceId: uuid('cover_face_id'),
    hidden: boolean('hidden').notNull().default(false),
    mergedIntoId: uuid('merged_into_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('person_merged_idx').on(table.mergedIntoId)],
);

/** A detected face in one asset, with its ArcFace embedding. */
export const face = pgTable(
  'face',
  {
    id: uuid('id').primaryKey(),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => asset.id, { onDelete: 'cascade' }),
    personId: uuid('person_id').references(() => person.id, { onDelete: 'set null' }),
    /** 'auto' assignments may be re-clustered; 'user' assignments never move. */
    assignment: text('assignment').notNull().default('auto'),
    /** x, y, w, h normalized to 0..1 of the source image. */
    bbox: real('bbox').array().notNull(),
    quality: real('quality').notNull(),
    ignored: boolean('ignored').notNull().default(false),
    embedding: vector('embedding', { dimensions: 512 }).notNull(),
    embedModel: text('embed_model').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('face_asset_idx').on(table.assetId),
    index('face_person_idx').on(table.personId),
    check('face_assignment_check', sql`${table.assignment} in ('auto', 'user')`),
  ],
);

/** CLIP image embeddings, keyed by model so upgrades can run side by side. */
export const assetEmbedding = pgTable(
  'asset_embedding',
  {
    assetId: uuid('asset_id')
      .notNull()
      .references(() => asset.id, { onDelete: 'cascade' }),
    model: text('model').notNull(),
    embedding: vector('embedding', { dimensions: 768 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.assetId, table.model] })],
);
