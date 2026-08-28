import { CookieOptions, Response } from 'express';
import { ACCESS_TOKEN_TTL_SECONDS, REFRESH_TOKEN_TTL_DAYS } from './token.service';

/** Cookie carrying the short-lived access JWT. */
export const ACCESS_COOKIE = 'rc_access';

/** Cookie carrying the opaque rotating refresh token; scoped to the auth endpoints. */
export const REFRESH_COOKIE = 'rc_refresh';

const REFRESH_COOKIE_PATH = '/api/v1/auth';
const MILLISECONDS_PER_SECOND = 1000;
const SECONDS_PER_DAY = 24 * 60 * 60;

/**
 * Secure follows the request's own protocol: a login over the nginx HTTPS
 * proxy (TRUST_PROXY set, X-Forwarded-Proto honored) gets Secure cookies the
 * browser will never send over plaintext, while direct LAN HTTP keeps working.
 */
function baseOptions(res: Response): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: res.req?.secure === true,
  };
}

/** Writes both session cookies onto the response. */
export function setAuthCookies(res: Response, accessToken: string, refreshToken: string): void {
  res.cookie(ACCESS_COOKIE, accessToken, {
    ...baseOptions(res),
    path: '/',
    maxAge: ACCESS_TOKEN_TTL_SECONDS * MILLISECONDS_PER_SECOND,
  });
  res.cookie(REFRESH_COOKIE, refreshToken, {
    ...baseOptions(res),
    path: REFRESH_COOKIE_PATH,
    maxAge: REFRESH_TOKEN_TTL_DAYS * SECONDS_PER_DAY * MILLISECONDS_PER_SECOND,
  });
}

/** Clears both session cookies (logout). */
export function clearAuthCookies(res: Response): void {
  res.clearCookie(ACCESS_COOKIE, { ...baseOptions(res), path: '/' });
  res.clearCookie(REFRESH_COOKIE, { ...baseOptions(res), path: REFRESH_COOKIE_PATH });
}
