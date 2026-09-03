import { CookieOptions, Request, Response } from 'express';

/**
 * Cookie carrying the in-flight OIDC transaction between /oidc/start and
 * /oidc/callback: the PKCE verifier, state, nonce, and where to land after.
 * Short-lived and path-scoped to the OIDC endpoints; the verifier is not a
 * secret from the person holding the browser, so an unencrypted (but httpOnly)
 * cookie is the standard carrier for it.
 */
export const OIDC_TRANSACTION_COOKIE = 'rc_oidc';

const TRANSACTION_COOKIE_PATH = '/api/v1/auth/oidc';
const TRANSACTION_TTL_MS = 5 * 60 * 1000;

/** Everything the callback needs to finish the login it started. */
export interface OidcTransaction {
  state: string;
  nonce: string;
  codeVerifier: string;
  returnUrl: string;
}

function baseOptions(res: Response): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: res.req?.secure === true,
    path: TRANSACTION_COOKIE_PATH,
  };
}

/** Stores the transaction for the round-trip to the IdP. */
export function setOidcTransactionCookie(res: Response, transaction: OidcTransaction): void {
  const encoded = Buffer.from(JSON.stringify(transaction), 'utf8').toString('base64url');
  res.cookie(OIDC_TRANSACTION_COOKIE, encoded, {
    ...baseOptions(res),
    maxAge: TRANSACTION_TTL_MS,
  });
}

/** Reads and validates the transaction; null when absent or malformed. */
export function readOidcTransactionCookie(req: Request): OidcTransaction | null {
  const raw = (req.cookies as Record<string, string> | undefined)?.[OIDC_TRANSACTION_COOKIE];
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as OidcTransaction;
    const isComplete =
      typeof parsed.state === 'string' &&
      typeof parsed.nonce === 'string' &&
      typeof parsed.codeVerifier === 'string' &&
      typeof parsed.returnUrl === 'string';
    return isComplete ? parsed : null;
  } catch {
    // A garbled cookie is indistinguishable from no transaction; the caller
    // sends the user back to the login page to start over.
    return null;
  }
}

/** Removes the transaction cookie (always done in the callback, win or lose). */
export function clearOidcTransactionCookie(res: Response): void {
  res.clearCookie(OIDC_TRANSACTION_COOKIE, baseOptions(res));
}
