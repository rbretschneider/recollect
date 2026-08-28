import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { userAccount } from './identity';

/**
 * A tokened public link to a Memory or an Album (FRD story S14.2). Anyone with
 * the URL can view; no account required. Revocable; optional expiry.
 */
export const shareLink = pgTable(
  'share_link',
  {
    id: uuid('id').primaryKey(),
    /** High-entropy URL token; the capability itself. */
    token: text('token').notNull().unique(),
    targetType: text('target_type').notNull(),
    targetId: uuid('target_id').notNull(),
    /** Whether journal text is included for shared memories (opt-in). */
    includeJournal: boolean('include_journal').notNull().default(false),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => userAccount.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    viewCount: integer('view_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('share_link_target_idx').on(table.targetType, table.targetId),
    check(
      'share_link_target_type_check',
      sql`${table.targetType} in ('memory', 'album', 'asset')`,
    ),
  ],
);
