import { CookieOptions, Response } from 'express';
import { ACCESS_TOKEN_TTL_SECONDS, REFRESH_TOKEN_TTL_DAYS } from './token.service';

/** Cookie carrying the short-lived access JWT. */
export const ACCESS_COOKIE = 'rc_access';

/** Cookie carrying the opaque rotating refresh token; scoped to the auth endpoints. */
export const REFRESH_COOKIE = 'rc_refresh';

const REFRESH_COOKIE_PATH = '/api/v1/auth';
const MILLISECONDS_PER_SECOND = 1000;
const SECONDS_PER_DAY = 24 * 60 * 60;

const baseOptions: CookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  secure: false, // Self-hosted behind the user's own network/TLS proxy; revisit with HTTPS config.
};

/** Writes both session cookies onto the response. */
export function setAuthCookies(res: Response, accessToken: string, refreshToken: string): void {
  res.cookie(ACCESS_COOKIE, accessToken, {
    ...baseOptions,
    path: '/',
    maxAge: ACCESS_TOKEN_TTL_SECONDS * MILLISECONDS_PER_SECOND,
  });
  res.cookie(REFRESH_COOKIE, refreshToken, {
    ...baseOptions,
    path: REFRESH_COOKIE_PATH,
    maxAge: REFRESH_TOKEN_TTL_DAYS * SECONDS_PER_DAY * MILLISECONDS_PER_SECOND,
  });
}

/** Clears both session cookies (logout). */
export function clearAuthCookies(res: Response): void {
  res.clearCookie(ACCESS_COOKIE, { ...baseOptions, path: '/' });
  res.clearCookie(REFRESH_COOKIE, { ...baseOptions, path: REFRESH_COOKIE_PATH });
}
