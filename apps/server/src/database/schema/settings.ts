import { jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/** Small key/value store for app-level configuration set through the UI. */
export const appSetting = pgTable('app_setting', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
