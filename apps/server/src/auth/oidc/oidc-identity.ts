/**
 * The pure decision at the heart of SSO login: which local account, if any,
 * does a verified IdP identity get? Kept free of I/O so the account-takeover
 * edge cases are unit-testable.
 */

/** Identity claims extracted from a validated ID token. */
export interface OidcIdentityClaims {
  issuer: string;
  subject: string;
  email: string | null;
  isEmailVerified: boolean;
}

/** What the caller should do with this identity. */
export type OidcLinkDecision =
  /** A link row already ties (issuer, subject) to this account. */
  | { action: 'login'; userId: string }
  /** First SSO login: attach the identity to the account matching the verified email. */
  | { action: 'link-and-login'; userId: string }
  /** No account for this identity; provisioning is deliberately manual. */
  | { action: 'reject'; reason: 'no-account' }
  /** The IdP would not vouch for the email, so email matching is unsafe. */
  | { action: 'reject'; reason: 'email-unverified' };

/**
 * Decides how a validated IdP identity maps onto local accounts.
 *
 * The rules, in order:
 * 1. An existing (issuer, subject) link always wins — email is ignored from
 *    then on, so an email change at the IdP can never move the login onto a
 *    different person's account.
 * 2. With no link yet, a matching local email attaches the identity — but only
 *    when the IdP asserts the email is verified. An unverified email is
 *    exactly the account-takeover vector this guard exists for.
 * 3. Otherwise reject: accounts are created by the admin, never auto-provisioned.
 */
export function decideOidcLink(
  claims: OidcIdentityClaims,
  linkedUserId: string | null,
  emailMatchedUserId: string | null,
): OidcLinkDecision {
  if (linkedUserId !== null) {
    return { action: 'login', userId: linkedUserId };
  }
  if (emailMatchedUserId === null || claims.email === null) {
    return { action: 'reject', reason: 'no-account' };
  }
  if (!claims.isEmailVerified) {
    return { action: 'reject', reason: 'email-unverified' };
  }
  return { action: 'link-and-login', userId: emailMatchedUserId };
}
