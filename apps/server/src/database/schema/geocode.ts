import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * Reverse-geocode memoization: one Nominatim lookup per ~1km grid cell, ever.
 * Key is "lat,lon" rounded to 2 decimals; label is the human place name.
 */
export const geocodeCache = pgTable('geocode_cache', {
  cellKey: text('cell_key').primaryKey(),
  label: text('label'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
