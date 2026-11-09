import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { asset } from './library';
import { person } from './people';

export const assetCaption = pgTable('asset_caption', {
  id: uuid('id').primaryKey(),
  assetId: uuid('asset_id').notNull().references(() => asset.id, { onDelete: 'cascade' }),
  text: text('text').notNull(),
  saidByPersonId: uuid('said_by_person_id').references(() => person.id, { onDelete: 'set null' }),
  saidByLabel: text('said_by_label'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('asset_caption_asset_order_idx').on(t.assetId, t.createdAt, t.id),
  index('asset_caption_person_idx').on(t.saidByPersonId),
  check('asset_caption_text_check', sql`char_length(${t.text}) between 1 and 500`),
  check('asset_caption_label_check', sql`${t.saidByLabel} is null or length(btrim(${t.saidByLabel})) > 0`),
  check('asset_caption_person_label_check', sql`${t.saidByPersonId} is null or ${t.saidByLabel} is not null`),
]);
