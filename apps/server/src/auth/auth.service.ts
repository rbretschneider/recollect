import { ConflictException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
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

  async login(email: string, password: string, deviceLabel?: string): Promise<IssuedTokens> {
    const found = await this.users.findByEmailWithHash(email);
    if (!found || !(await this.passwords.verify(found.passwordHash, password))) {
      throw new UnauthorizedException('Invalid email or password.');
    }
    return this.issueTokens(found.profile, deviceLabel);
  }

  /** Rotates the refresh token and issues a fresh access token. */
  async refresh(refreshToken: string): Promise<IssuedTokens> {
    const tokenHash = this.tokens.hashRefreshToken(refreshToken);
    const [row] = await this.db
      .select()
      .from(session)
      .where(and(eq(session.refreshTokenHash, tokenHash), isNull(session.revokedAt)))
      .limit(1);
    if (!row || row.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('Session is no longer valid.');
    }
    const user = await this.users.findById(row.userId);
    if (!user) {
      throw new UnauthorizedException('Account is no longer active.');
    }
    const rotated = this.tokens.generateRefreshToken();
    await this.db
      .update(session)
      .set({ refreshTokenHash: rotated.tokenHash, lastUsedAt: new Date() })
      .where(eq(session.id, row.id));
    return {
      accessToken: await this.tokens.signAccessToken(user.id),
      refreshToken: rotated.token,
      user,
    };
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
      accessToken: await this.tokens.signAccessToken(user.id),
      refreshToken: refresh.token,
      user,
    };
  }
}
