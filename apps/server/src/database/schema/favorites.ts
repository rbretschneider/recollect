import { pgTable, primaryKey, timestamp, uuid } from 'drizzle-orm/pg-core';
import { userAccount } from './identity';
import { asset } from './library';

/** A personal heart on a photo — per user, never shared state. */
export const favorite = pgTable(
  'favorite',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => userAccount.id, { onDelete: 'cascade' }),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => asset.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.assetId] })],
);
