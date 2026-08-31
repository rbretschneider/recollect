import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/** Household member login accounts. Permission is a cumulative grant: read ⊂ write ⊂ delete. */
export const userAccount = pgTable(
  'user_account',
  {
    id: uuid('id').primaryKey(),
    email: text('email').notNull(),
    displayName: text('display_name').notNull(),
    passwordHash: text('password_hash').notNull(),
    permission: text('permission').notNull().default('read'),
    isAdmin: boolean('is_admin').notNull().default(false),
    mustChangePassword: boolean('must_change_password').notNull().default(false),
    /**
     * Bumped whenever every live access token for this account must die at once
     * (password change, "sign out everywhere", disable). The access JWT carries
     * the value it was minted with; the auth guard rejects any token whose
     * version is behind the account's — closing the up-to-15-minute window a
     * stateless JWT would otherwise stay valid for.
     */
    tokenVersion: integer('token_version').notNull().default(0),
    /**
     * "This account IS this person" — links the login to their face-recognized
     * identity (plain uuid: person lives in another schema file, and a FK here
     * would create a circular import).
     */
    personId: uuid('person_id'),
    disabledAt: timestamp('disabled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('user_account_email_unique').on(sql`lower(${table.email})`),
    check('user_account_permission_check', sql`${table.permission} in ('read', 'write', 'delete')`),
  ],
);

/** Refresh-token sessions; rotated on every refresh, individually revocable. */
export const session = pgTable(
  'session',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => userAccount.id, { onDelete: 'cascade' }),
    refreshTokenHash: text('refresh_token_hash').notNull(),
    /**
     * The hash this session rotated away from. A refresh presenting it again
     * is token reuse — the classic stolen-cookie signature — and revokes the
     * whole session.
     */
    prevRefreshTokenHash: text('prev_refresh_token_hash'),
    deviceLabel: text('device_label'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => [index('session_user_id_idx').on(table.userId)],
);

/** A browser's Web Push subscription (one row per installed PWA/device). */
export const pushSubscription = pgTable(
  'push_subscription',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id').notNull(),
    /** The push service endpoint URL — unique per browser subscription. */
    endpoint: text('endpoint').notNull().unique(),
    /** Client public key + auth secret for payload encryption (RFC 8291). */
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('push_subscription_user_id_idx').on(table.userId)],
);

/** Per-user notification settings (the daily "years ago" look-back push). */
export const notificationPref = pgTable('notification_pref', {
  userId: uuid('user_id').primaryKey(),
  dailyEnabled: boolean('daily_enabled').notNull().default(true),
  /** Local wall-clock time to send, "HH:MM" 24h. */
  dailyTime: text('daily_time').notNull().default('07:30'),
  /** IANA zone the time is interpreted in (captured from the device). */
  timezone: text('timezone').notNull().default('UTC'),
  /** Local calendar date we last sent, so a day never double-fires. */
  lastSentOn: date('last_sent_on'),
  /** Comma-joined moment keys from the last push, to skip an identical day. */
  lastMomentKeys: text('last_moment_keys'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Append-only record of every destructive or structural action. */
export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id').references(() => userAccount.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id'),
    detail: jsonb('detail'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('audit_log_created_at_idx').on(table.createdAt)],
);

