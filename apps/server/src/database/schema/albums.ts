import {
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { userAccount } from './identity';
import { asset } from './library';

/**
 * A manual collection of photos (PhotoPrism-style album). Unlike a Memory an
 * album has no event semantics — no date span of its own, no journal. Memories
 * answer "what happened"; albums answer "photos I grouped on purpose".
 */
export const album = pgTable(
  'album',
  {
    id: uuid('id').primaryKey(),
    title: text('title').notNull(),
    description: text('description'),
    coverAssetId: uuid('cover_asset_id').references(() => asset.id, { onDelete: 'set null' }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => userAccount.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [index('album_updated_idx').on(table.updatedAt.desc())],
);

/** Membership of assets in an album. */
export const albumAsset = pgTable(
  'album_asset',
  {
    albumId: uuid('album_id')
      .notNull()
      .references(() => album.id, { onDelete: 'cascade' }),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => asset.id, { onDelete: 'cascade' }),
    sortOrder: integer('sort_order').notNull().default(0),
    addedBy: uuid('added_by').references(() => userAccount.id, { onDelete: 'set null' }),
    addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.albumId, table.assetId] }),
    index('album_asset_asset_idx').on(table.assetId),
  ],
);
