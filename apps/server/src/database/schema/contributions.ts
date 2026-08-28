import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { album } from './albums';
import { userAccount } from './identity';
import { asset } from './library';

/**
 * A tokened public UPLOAD link for one album — the "event" contribution flow.
 * Guests with the URL can add photos (into quarantine, never the library) and,
 * when poolView is on, see the approved pool. Always expires; revocable.
 */
export const contributionLink = pgTable(
  'contribution_link',
  {
    id: uuid('id').primaryKey(),
    /** High-entropy URL token; the capability itself. */
    token: text('token').notNull().unique(),
    albumId: uuid('album_id')
      .notNull()
      .references(() => album.id, { onDelete: 'cascade' }),
    /** Whether guests see the approved photo pool (on for a party, off for drops). */
    poolView: boolean('pool_view').notNull().default(true),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => userAccount.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    uploadCount: integer('upload_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('contribution_link_album_idx').on(table.albumId)],
);

/**
 * One guest-uploaded file sitting in quarantine (or its audit trail after
 * review). The staged file lives under APP_DATA_DIR/staging until a household
 * member approves (→ ingested as a real asset) or rejects (file deleted).
 */
export const guestUpload = pgTable(
  'guest_upload',
  {
    id: uuid('id').primaryKey(),
    linkId: uuid('link_id')
      .notNull()
      .references(() => contributionLink.id, { onDelete: 'cascade' }),
    albumId: uuid('album_id')
      .notNull()
      .references(() => album.id, { onDelete: 'cascade' }),
    /** The name the guest typed once; future "Taken by" attribution. */
    uploaderName: text('uploader_name').notNull(),
    originalFilename: text('original_filename').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    mime: text('mime').notNull(),
    mediaType: text('media_type').notNull(),
    status: text('status').notNull().default('pending'),
    /** Set on approval: the ingested asset this upload became. */
    assetId: uuid('asset_id').references(() => asset.id, { onDelete: 'set null' }),
    reviewedBy: uuid('reviewed_by'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('guest_upload_album_status_idx').on(table.albumId, table.status),
    check('guest_upload_status_check', sql`${table.status} in ('pending', 'approved', 'rejected')`),
    check(
      'guest_upload_media_type_check',
      sql`${table.mediaType} in ('image', 'video')`,
    ),
  ],
);
