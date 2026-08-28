import { pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';
import { asset } from './library';

/**
 * "Leave this one alone": a dismissed cleanup suggestion never comes back
 * (also written after a successful conversion, retiring the suggestion).
 */
export const cleanupDismissal = pgTable('cleanup_dismissal', {
  assetId: uuid('asset_id')
    .primaryKey()
    .references(() => asset.id, { onDelete: 'cascade' }),
  dismissedBy: uuid('dismissed_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
