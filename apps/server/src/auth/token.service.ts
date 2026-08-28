import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'crypto';
import { APP_CONFIG } from '../config/app-config';
import type { AppConfig } from '../config/app-config';

/** Lifetime of a short-lived access token. */
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

/** Lifetime of a refresh session before re-login is required. */
export const REFRESH_TOKEN_TTL_DAYS = 30;

/** An opaque refresh token paired with the hash we persist. */
export interface RefreshTokenPair {
  token: string;
  tokenHash: string;
}

/** Issues and verifies access JWTs and opaque refresh tokens. */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async signAccessToken(userId: string, tokenVersion: number): Promise<string> {
    return this.jwt.signAsync(
      { sub: userId, ver: tokenVersion },
      { secret: this.config.authTokenSecret, expiresIn: ACCESS_TOKEN_TTL_SECONDS },
    );
  }

  /**
   * Returns the user id and token version from a valid access token, or null
   * when the signature/expiry is invalid. The version lets the guard reject
   * tokens minted before a password change or "sign out everywhere".
   */
  async verifyAccessToken(token: string): Promise<{ userId: string; tokenVersion: number } | null> {
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string; ver?: number }>(token, {
        secret: this.config.authTokenSecret,
      });
      return { userId: payload.sub, tokenVersion: payload.ver ?? 0 };
    } catch {
      return null;
    }
  }

  generateRefreshToken(): RefreshTokenPair {
    const token = randomBytes(32).toString('hex');
    return { token, tokenHash: this.hashRefreshToken(token) };
  }

  hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
