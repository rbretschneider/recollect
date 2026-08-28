import { ConflictException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { and, eq, isNull, or } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { DATABASE } from '../database/database.module';
import type { Database } from '../database/database.module';
import { session } from '../database/schema';
import { UsersService } from '../users/users.service';
import { UserProfile } from '../users/user.types';
import { PasswordService } from './password.service';
import { REFRESH_TOKEN_TTL_DAYS, TokenService } from './token.service';

/** Tokens issued after a successful login or refresh. */
export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  user: UserProfile;
}

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

/** Handles first-run setup, login, session refresh, and logout. */
@Injectable()
export class AuthService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly users: UsersService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
  ) {}

  /** Whether the app has no accounts yet and needs first-run setup. */
  async needsSetup(): Promise<boolean> {
    return (await this.users.countUsers()) === 0;
  }

  /** Creates the initial admin account (admin + delete grant). Only valid when no users exist. */
  async completeSetup(email: string, displayName: string, password: string): Promise<IssuedTokens> {
    if (!(await this.needsSetup())) {
      throw new ConflictException('Setup has already been completed.');
    }
    const user = await this.users.create({
      email,
      displayName,
      password,
      permission: 'delete',
      isAdmin: true,
    });
    return this.issueTokens(user);
  }

  /**
   * A real Argon2 hash of random bytes, verified against on unknown-email
   * logins so both miss paths take the same time — no email enumeration by
   * timing. Built lazily once.
   */
  private dummyHashPromise: Promise<string> | null = null;

  async login(email: string, password: string, deviceLabel?: string): Promise<IssuedTokens> {
    const found = await this.users.findByEmailWithHash(email);
    if (!found) {
      this.dummyHashPromise ??= this.passwords.hash(randomBytes(24).toString('hex'));
      await this.passwords.verify(await this.dummyHashPromise, password);
      throw new UnauthorizedException('Invalid email or password.');
    }
    if (!(await this.passwords.verify(found.passwordHash, password))) {
      throw new UnauthorizedException('Invalid email or password.');
    }
    return this.issueTokens(found.profile, deviceLabel);
  }

  /**
   * Rotates the refresh token and issues a fresh access token. Presenting the
   * PREVIOUS token of a session is reuse — the stolen-cookie signature (two
   * parties holding one session) — and kills the session for both.
   */
  async refresh(refreshToken: string): Promise<IssuedTokens> {
    const tokenHash = this.tokens.hashRefreshToken(refreshToken);
    const [row] = await this.db
      .select()
      .from(session)
      .where(
        and(
          or(
            eq(session.refreshTokenHash, tokenHash),
            eq(session.prevRefreshTokenHash, tokenHash),
          ),
          isNull(session.revokedAt),
        ),
      )
      .limit(1);
    if (!row || row.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('Session is no longer valid.');
    }
    if (row.refreshTokenHash !== tokenHash) {
      await this.db
        .update(session)
        .set({ revokedAt: new Date() })
        .where(eq(session.id, row.id));
      throw new UnauthorizedException('Session is no longer valid.');
    }
    const user = await this.users.findById(row.userId);
    if (!user) {
      throw new UnauthorizedException('Account is no longer active.');
    }
    const rotated = this.tokens.generateRefreshToken();
    await this.db
      .update(session)
      .set({
        refreshTokenHash: rotated.tokenHash,
        prevRefreshTokenHash: tokenHash,
        lastUsedAt: new Date(),
      })
      .where(eq(session.id, row.id));
    return {
      accessToken: await this.tokens.signAccessToken(user.id, user.tokenVersion),
      refreshToken: rotated.token,
      user,
    };
  }

  /**
   * Self-service password change. Every session — this device's included — is
   * revoked and a fresh one issued in the same response, so a change after a
   * suspected leak doubles as "sign out everywhere".
   */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<IssuedTokens> {
    const user = await this.users.verifyPassword(userId, currentPassword);
    if (!user) {
      throw new UnauthorizedException('Current password is incorrect.');
    }
    await this.users.setPassword(userId, newPassword, { mustChangePassword: false });
    await this.revokeAllSessions(userId);
    // Re-read so the response carries the cleared mustChangePassword flag.
    const fresh = await this.users.findById(userId);
    return this.issueTokens(fresh ?? user);
  }

  /** Admin reset: new password, forced change at next login, every session dead. */
  async adminResetPassword(userId: string, newPassword: string): Promise<void> {
    await this.users.setPassword(userId, newPassword, { mustChangePassword: true });
    await this.revokeAllSessions(userId);
  }

  async revokeAllSessions(userId: string): Promise<void> {
    await this.db
      .update(session)
      .set({ revokedAt: new Date() })
      .where(and(eq(session.userId, userId), isNull(session.revokedAt)));
    // Kill every live access token too, not just the refresh sessions.
    await this.users.bumpTokenVersion(userId);
  }

  async logout(refreshToken: string): Promise<void> {
    const tokenHash = this.tokens.hashRefreshToken(refreshToken);
    await this.db
      .update(session)
      .set({ revokedAt: new Date() })
      .where(eq(session.refreshTokenHash, tokenHash));
  }

  private async issueTokens(user: UserProfile, deviceLabel?: string): Promise<IssuedTokens> {
    const refresh = this.tokens.generateRefreshToken();
    await this.db.insert(session).values({
      id: uuidv7(),
      userId: user.id,
      refreshTokenHash: refresh.tokenHash,
      deviceLabel: deviceLabel ?? null,
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * MILLISECONDS_PER_DAY),
    });
    return {
      accessToken: await this.tokens.signAccessToken(user.id, user.tokenVersion),
      refreshToken: refresh.token,
      user,
    };
  }
}
