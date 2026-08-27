import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { userAccount } from './identity';
import { asset } from './library';

/**
 * A machine-detected candidate event (Memory suggestion). Regenerable and
 * disposable — the clustering job may rewrite anything not accepted/dismissed.
 * Humans own `memory`; machines own this table (data-model.md §1.2).
 */
export const eventCluster = pgTable(
  'event_cluster',
  {
    id: uuid('id').primaryKey(),
    algoVersion: integer('algo_version').notNull(),
    status: text('status').notNull().default('suggested'),
    startAt: timestamp('start_at', { withTimezone: true }).notNull(),
    endAt: timestamp('end_at', { withTimezone: true }).notNull(),
    seedTitle: text('seed_title').notNull(),
    score: real('score').notNull(),
    /** Explainability: gaps, distances, member count that produced this cluster. */
    signals: jsonb('signals'),
    /** Stable hash of the sorted member set — identical re-detections stay dismissed. */
    memberSignature: text('member_signature').notNull(),
    acceptedMemoryId: uuid('accepted_memory_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('event_cluster_status_idx').on(table.status, table.score),
    index('event_cluster_signature_idx').on(table.memberSignature),
    check(
      'event_cluster_status_check',
      sql`${table.status} in ('suggested', 'accepted', 'dismissed', 'superseded')`,
    ),
  ],
);

/** Membership of assets in a cluster. */
export const eventClusterAsset = pgTable(
  'event_cluster_asset',
  {
    clusterId: uuid('cluster_id')
      .notNull()
      .references(() => eventCluster.id, { onDelete: 'cascade' }),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => asset.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({ columns: [table.clusterId, table.assetId] }),
    index('event_cluster_asset_asset_idx').on(table.assetId),
  ],
);

/** A confirmed Memory — human-owned; never mutated by machine code. */
export const memory = pgTable(
  'memory',
  {
    id: uuid('id').primaryKey(),
    title: text('title').notNull(),
    description: text('description'),
    startAt: timestamp('start_at', { withTimezone: true }).notNull(),
    endAt: timestamp('end_at', { withTimezone: true }).notNull(),
    datePrecision: text('date_precision').notNull().default('exact'),
    coverAssetId: uuid('cover_asset_id').references(() => asset.id, { onDelete: 'set null' }),
    locationLabel: text('location_label'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => userAccount.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedBy: uuid('deleted_by').references(() => userAccount.id, { onDelete: 'set null' }),
  },
  (table) => [
    index('memory_timeline_idx').on(table.startAt.desc()),
    check(
      'memory_date_precision_check',
      sql`${table.datePrecision} in ('exact', 'day', 'month', 'year', 'approx')`,
    ),
  ],
);

/** Media attached to a Memory. Survives asset trash/missing (tombstone render). */
export const memoryAsset = pgTable(
  'memory_asset',
  {
    memoryId: uuid('memory_id')
      .notNull()
      .references(() => memory.id, { onDelete: 'cascade' }),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => asset.id, { onDelete: 'cascade' }),
    sortOrder: integer('sort_order').notNull().default(0),
    addedBy: uuid('added_by').references(() => userAccount.id, { onDelete: 'set null' }),
    addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.memoryId, table.assetId] }),
    index('memory_asset_asset_idx').on(table.assetId),
  ],
);

/**
 * A "quote of the day" on a Memory — the funny thing somebody said, with
 * attribution. As irreplaceable as the journal; never machine-touched.
 */
export const memoryQuote = pgTable(
  'memory_quote',
  {
    id: uuid('id').primaryKey(),
    memoryId: uuid('memory_id')
      .notNull()
      .references(() => memory.id, { onDelete: 'cascade' }),
    text: text('text').notNull(),
    /** Who said it — free text ("Emma, 4"), not an account. */
    saidBy: text('said_by').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => userAccount.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('memory_quote_memory_idx').on(table.memoryId)],
);

/** Human-authored narrative on a Memory. The irreplaceable data — never machine-touched. */
export const journalEntry = pgTable(
  'journal_entry',
  {
    id: uuid('id').primaryKey(),
    memoryId: uuid('memory_id')
      .notNull()
      .references(() => memory.id, { onDelete: 'cascade' }),
    authorUserId: uuid('author_user_id')
      .notNull()
      .references(() => userAccount.id, { onDelete: 'restrict' }),
    bodyMd: text('body_md').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('journal_entry_memory_idx').on(table.memoryId)],
);
