import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { userAccount } from './identity';

/** A folder tree the library engine indexes in place (never copies). */
export const libraryRoot = pgTable('library_root', {
  id: uuid('id').primaryKey(),
  path: text('path').notNull().unique(),
  name: text('name').notNull(),
  excludeGlobs: text('exclude_globs').array().notNull().default([]),
  enabled: boolean('enabled').notNull().default(true),
  lastScanStartedAt: timestamp('last_scan_started_at', { withTimezone: true }),
  lastScanCompletedAt: timestamp('last_scan_completed_at', { withTimezone: true }),
  /** How many ingest jobs the last scan enqueued — the denominator for progress. */
  lastScanEnqueued: integer('last_scan_enqueued').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * The logical photo/video, keyed by content hash. Memories, favorites, and faces
 * all reference this row; it survives any on-disk reorganization.
 */
export const asset = pgTable(
  'asset',
  {
    id: uuid('id').primaryKey(),
    /** SHA-256 of file content, lowercase hex — the durable identity. */
    contentHash: text('content_hash').notNull().unique(),
    mediaType: text('media_type').notNull(),
    mime: text('mime').notNull(),
    width: integer('width'),
    height: integer('height'),
    durationMs: integer('duration_ms'),
    orientation: smallint('orientation'),
    capturedAt: timestamp('captured_at', { withTimezone: true }).notNull(),
    capturedTzOffsetMin: smallint('captured_tz_offset_min'),
    capturedAtSource: text('captured_at_source').notNull(),
    /** Local calendar day of capture; maintained by the app on every capturedAt write. */
    capturedDay: date('captured_day').notNull(),
    gpsLat: doublePrecision('gps_lat'),
    gpsLon: doublePrecision('gps_lon'),
    gpsAltM: real('gps_alt_m'),
    /** Video codec id from container metadata (e.g. 'hvc1', 'avc1'); drives playback transcoding. */
    videoCodec: text('video_codec'),
    cameraMake: text('camera_make'),
    cameraModel: text('camera_model'),
    lensModel: text('lens_model'),
    status: text('status').notNull().default('active'),
    trashedAt: timestamp('trashed_at', { withTimezone: true }),
    trashedBy: uuid('trashed_by').references(() => userAccount.id, { onDelete: 'set null' }),
    stageMetadataAt: timestamp('stage_metadata_at', { withTimezone: true }),
    stageThumbsAt: timestamp('stage_thumbs_at', { withTimezone: true }),
    stageErrors: jsonb('stage_errors'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('asset_timeline_idx').on(table.capturedAt.desc(), table.id.desc()),
    index('asset_captured_day_idx').on(table.capturedDay),
    check('asset_media_type_check', sql`${table.mediaType} in ('image', 'video')`),
    check(
      'asset_captured_at_source_check',
      sql`${table.capturedAtSource} in ('exif', 'filename', 'file_mtime', 'user')`,
    ),
    check('asset_status_check', sql`${table.status} in ('active', 'missing', 'trashed')`),
  ],
);

/** A physical location of an asset's content on disk. One asset may have several (duplicates). */
export const assetFile = pgTable(
  'asset_file',
  {
    id: uuid('id').primaryKey(),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => asset.id, { onDelete: 'cascade' }),
    rootId: uuid('root_id')
      .notNull()
      .references(() => libraryRoot.id, { onDelete: 'cascade' }),
    relPath: text('rel_path').notNull(),
    fileName: text('file_name').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    fsMtime: timestamp('fs_mtime', { withTimezone: true }).notNull(),
    state: text('state').notNull().default('present'),
    trashPath: text('trash_path'),
    originalRelPath: text('original_rel_path'),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastVerifiedAt: timestamp('last_verified_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('asset_file_root_path_unique').on(table.rootId, table.relPath),
    index('asset_file_asset_id_idx').on(table.assetId),
    check('asset_file_state_check', sql`${table.state} in ('present', 'missing', 'trashed')`),
  ],
);

/** Full raw exiftool output, kept off the hot asset table. */
export const assetMetadata = pgTable('asset_metadata', {
  assetId: uuid('asset_id')
    .primaryKey()
    .references(() => asset.id, { onDelete: 'cascade' }),
  raw: jsonb('raw').notNull(),
  extractedAt: timestamp('extracted_at', { withTimezone: true }).notNull().defaultNow(),
});
