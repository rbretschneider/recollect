import { decideOidcLink, OidcIdentityClaims } from './oidc-identity';

const ISSUER = 'https://auth.example.com/application/o/recollect/';

function claims(overrides: Partial<OidcIdentityClaims> = {}): OidcIdentityClaims {
  return {
    issuer: ISSUER,
    subject: 'idp-subject-1',
    email: 'ryan@example.com',
    isEmailVerified: true,
    ...overrides,
  };
}

describe('decideOidcLink', () => {
  it('logs a linked identity straight in', () => {
    const decision = decideOidcLink(claims(), 'user-1', null);

    expect(decision).toEqual({ action: 'login', userId: 'user-1' });
  });

  it('prefers the existing link even when the email now matches someone else', () => {
    // The IdP reassigned the email to another person; the link must not move.
    const decision = decideOidcLink(claims(), 'user-1', 'user-2');

    expect(decision).toEqual({ action: 'login', userId: 'user-1' });
  });

  it('attaches a first-time identity to the account matching a verified email', () => {
    const decision = decideOidcLink(claims(), null, 'user-2');

    expect(decision).toEqual({ action: 'link-and-login', userId: 'user-2' });
  });

  it('refuses to link on an unverified email — the account-takeover vector', () => {
    const decision = decideOidcLink(claims({ isEmailVerified: false }), null, 'user-2');

    expect(decision).toEqual({ action: 'reject', reason: 'email-unverified' });
  });

  it('rejects an identity with no local account instead of auto-provisioning', () => {
    const decision = decideOidcLink(claims(), null, null);

    expect(decision).toEqual({ action: 'reject', reason: 'no-account' });
  });

  it('rejects when the token carries no email at all', () => {
    const decision = decideOidcLink(claims({ email: null }), null, 'user-2');

    expect(decision).toEqual({ action: 'reject', reason: 'no-account' });
  });
});
