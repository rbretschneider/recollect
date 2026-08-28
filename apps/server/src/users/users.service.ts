import { Inject, Injectable } from '@nestjs/common';
import { count, eq, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { PasswordService } from '../auth/password.service';
import { Permission } from '../auth/permission';
import { DATABASE } from '../database/database.module';
import type { Database } from '../database/database.module';
import { userAccount } from '../database/schema';
import { CreateUserInput, UpdateUserInput, UserProfile } from './user.types';

/** Manages household member accounts. */
@Injectable()
export class UsersService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly passwords: PasswordService,
  ) {}

  async countUsers(): Promise<number> {
    const [row] = await this.db.select({ value: count() }).from(userAccount);
    return row.value;
  }

  /** All active accounts, for the admin settings page. */
  async list(): Promise<UserProfile[]> {
    const rows = await this.db.select().from(userAccount).orderBy(userAccount.createdAt);
    return rows.filter((row) => row.disabledAt === null).map((row) => this.toProfile(row));
  }

  /**
   * Short-lived profile memo: the auth guard calls this on EVERY request —
   * including each of the ~100 thumbnails a grid screen loads — so a 30s
   * cache removes ~99% of those lookups. Writes call invalidateProfile().
   */
  private readonly profileCache = new Map<
    string,
    { profile: UserProfile | null; expiresAt: number }
  >();

  async findById(id: string): Promise<UserProfile | null> {
    const cached = this.profileCache.get(id);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.profile;
    }
    const [row] = await this.db.select().from(userAccount).where(eq(userAccount.id, id)).limit(1);
    const profile = !row || row.disabledAt !== null ? null : this.toProfile(row);
    this.profileCache.set(id, { profile, expiresAt: Date.now() + 30_000 });
    return profile;
  }

  /** Drops a memoized profile after any account change (grant edits, disable). */
  invalidateProfile(id: string): void {
    this.profileCache.delete(id);
  }

  async findByEmailWithHash(
    email: string,
  ): Promise<{ profile: UserProfile; passwordHash: string } | null> {
    const [row] = await this.db
      .select()
      .from(userAccount)
      .where(sql`lower(${userAccount.email}) = lower(${email})`)
      .limit(1);
    if (!row || row.disabledAt !== null) {
      return null;
    }
    return { profile: this.toProfile(row), passwordHash: row.passwordHash };
  }

  /** Verifies a password for an existing account; null when wrong or disabled. */
  async verifyPassword(userId: string, password: string): Promise<UserProfile | null> {
    const [row] = await this.db
      .select()
      .from(userAccount)
      .where(eq(userAccount.id, userId))
      .limit(1);
    if (!row || row.disabledAt !== null) {
      return null;
    }
    return (await this.passwords.verify(row.passwordHash, password)) ? this.toProfile(row) : null;
  }

  async setPassword(
    userId: string,
    newPassword: string,
    options: { mustChangePassword: boolean },
  ): Promise<void> {
    await this.db
      .update(userAccount)
      .set({
        passwordHash: await this.passwords.hash(newPassword),
        mustChangePassword: options.mustChangePassword,
      })
      .where(eq(userAccount.id, userId));
    this.invalidateProfile(userId);
  }

  async create(input: CreateUserInput): Promise<UserProfile> {
    const [row] = await this.db
      .insert(userAccount)
      .values({
        id: uuidv7(),
        email: input.email,
        displayName: input.displayName,
        passwordHash: await this.passwords.hash(input.password),
        permission: input.permission,
        isAdmin: input.isAdmin,
      })
      .returning();
    return this.toProfile(row);
  }

  /** Admin edit of an existing member (name, grants, person link). */
  async update(userId: string, input: UpdateUserInput): Promise<UserProfile | null> {
    const [row] = await this.db
      .update(userAccount)
      .set({
        ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
        ...(input.permission !== undefined ? { permission: input.permission } : {}),
        ...(input.isAdmin !== undefined ? { isAdmin: input.isAdmin } : {}),
        ...(input.personId !== undefined ? { personId: input.personId } : {}),
        updatedAt: new Date(),
      })
      .where(eq(userAccount.id, userId))
      .returning();
    this.invalidateProfile(userId);
    return row ? this.toProfile(row) : null;
  }

  /** A disabled account can't sign in; its live sessions die within minutes. */
  async setDisabled(userId: string, disabled: boolean): Promise<void> {
    await this.db
      .update(userAccount)
      .set({ disabledAt: disabled ? new Date() : null, updatedAt: new Date() })
      .where(eq(userAccount.id, userId));
    this.invalidateProfile(userId);
  }

  /** Includes disabled accounts, flagged, for the admin members list. */
  async listAll(): Promise<Array<UserProfile & { disabled: boolean }>> {
    const rows = await this.db.select().from(userAccount).orderBy(userAccount.createdAt);
    return rows.map((row) => ({ ...this.toProfile(row), disabled: row.disabledAt !== null }));
  }

  private toProfile(row: typeof userAccount.$inferSelect): UserProfile {
    return {
      id: row.id,
      email: row.email,
      displayName: row.displayName,
      permission: row.permission as Permission,
      isAdmin: row.isAdmin,
      mustChangePassword: row.mustChangePassword,
      personId: row.personId,
      tokenVersion: row.tokenVersion,
    };
  }

  /**
   * Invalidates every live access token for the account at once by advancing
   * its version. Callers that also need a fresh profile must read after this.
   */
  async bumpTokenVersion(userId: string): Promise<void> {
    await this.db
      .update(userAccount)
      .set({ tokenVersion: sql`${userAccount.tokenVersion} + 1` })
      .where(eq(userAccount.id, userId));
    this.invalidateProfile(userId);
  }
}
