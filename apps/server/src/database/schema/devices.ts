import { pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

/**
 * Maps a camera (EXIF make + model, as stored on assets) to the person who
 * owns it, so a photo's metadata can say who took it. Empty string stands in
 * for a missing make/model so the pair stays uniquely indexable.
 */
export const deviceOwner = pgTable(
  'device_owner',
  {
    id: uuid('id').primaryKey(),
    cameraMake: text('camera_make').notNull().default(''),
    cameraModel: text('camera_model').notNull().default(''),
    ownerName: text('owner_name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('device_owner_device_idx').on(table.cameraMake, table.cameraModel)],
);
