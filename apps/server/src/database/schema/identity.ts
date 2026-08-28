import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
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

