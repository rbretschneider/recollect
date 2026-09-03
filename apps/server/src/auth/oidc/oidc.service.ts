import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import * as oidc from 'openid-client';
import { v7 as uuidv7 } from 'uuid';
import { APP_CONFIG } from '../../config/app-config';
import type { AppConfig } from '../../config/app-config';
import { DATABASE } from '../../database/database.module';
import type { Database } from '../../database/database.module';
import { identityLink, userAccount } from '../../database/schema';
import { UserProfile } from '../../users/user.types';
import { UsersService } from '../../users/users.service';
import { decideOidcLink, OidcIdentityClaims } from './oidc-identity';
import { OidcTransaction } from './oidc-transaction-cookie';

/** Where to send the browser to begin the IdP login, plus what to remember. */
export interface OidcLoginStart {
  authorizationUrl: string;
  transaction: OidcTransaction;
}

/** Why an SSO login could not complete; `code` becomes the login page's error. */
export class OidcLoginError extends Error {
  constructor(
    readonly code: 'sso_failed' | 'sso_no_account' | 'sso_email_unverified',
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'OidcLoginError';
  }
}

const OIDC_SCOPE = 'openid email profile';

/**
 * OIDC login against the configured IdP (authentik). The IdP only answers
 * "who is this?" — this service maps that identity onto a local account and
 * the normal session machinery takes over. Dormant unless configured.
 */
@Injectable()
export class OidcService {
  private readonly logger = new Logger(OidcService.name);

  /**
   * Discovery result, cached after the first successful fetch. Deliberately
   * lazy: the IdP being down must never break app boot, only SSO attempts.
   */
  private discoveryPromise: Promise<oidc.Configuration> | null = null;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DATABASE) private readonly db: Database,
    private readonly users: UsersService,
  ) {}

  /** Whether SSO is configured at all (drives the login page's button). */
  get isEnabled(): boolean {
    return this.config.oidcIssuerUrl !== '';
  }

  get buttonLabel(): string {
    return this.config.oidcButtonLabel;
  }

  /** Builds the IdP authorization redirect and the transaction to remember. */
  async beginLogin(redirectUri: string, returnUrl: string): Promise<OidcLoginStart> {
    const configuration = await this.discover();
    const codeVerifier = oidc.randomPKCECodeVerifier();
    const state = oidc.randomState();
    const nonce = oidc.randomNonce();
    const authorizationUrl = oidc.buildAuthorizationUrl(configuration, {
      redirect_uri: redirectUri,
      scope: OIDC_SCOPE,
      code_challenge: await oidc.calculatePKCECodeChallenge(codeVerifier),
      code_challenge_method: 'S256',
      state,
      nonce,
    });
    return {
      authorizationUrl: authorizationUrl.href,
      transaction: { state, nonce, codeVerifier, returnUrl },
    };
  }

  /**
   * Validates the IdP's callback, maps the identity to a local account, and
   * returns the account to sign in. Throws {@link OidcLoginError} otherwise.
   */
  async completeLogin(callbackUrl: URL, transaction: OidcTransaction): Promise<UserProfile> {
    const claims = await this.exchangeCode(callbackUrl, transaction);
    const decision = decideOidcLink(
      claims,
      await this.findLinkedUserId(claims),
      await this.findUserIdByVerifiedEmail(claims),
    );
    switch (decision.action) {
      case 'login': {
        return this.loadActiveUser(decision.userId, claims);
      }
      case 'link-and-login': {
        const user = await this.loadActiveUser(decision.userId, claims);
        await this.createLink(user.id, claims);
        this.logger.log(`Linked OIDC identity ${claims.subject} to account ${user.email}.`);
        return user;
      }
      case 'reject': {
        throw new OidcLoginError(
          decision.reason === 'email-unverified' ? 'sso_email_unverified' : 'sso_no_account',
          `SSO identity ${claims.subject} has no local account (${decision.reason}).`,
        );
      }
    }
  }

  /** Redeems the authorization code and returns the validated identity claims. */
  private async exchangeCode(
    callbackUrl: URL,
    transaction: OidcTransaction,
  ): Promise<OidcIdentityClaims> {
    const configuration = await this.discover();
    let tokens: oidc.TokenEndpointResponse & oidc.TokenEndpointResponseHelpers;
    try {
      tokens = await oidc.authorizationCodeGrant(configuration, callbackUrl, {
        pkceCodeVerifier: transaction.codeVerifier,
        expectedState: transaction.state,
        expectedNonce: transaction.nonce,
      });
    } catch (error) {
      // Log here because the browser only ever sees a generic error code —
      // the details (state mismatch, IdP rejection) matter to the operator.
      this.logger.warn(`OIDC code exchange failed: ${String(error)}`);
      throw new OidcLoginError('sso_failed', 'The identity provider rejected the login.', {
        cause: error,
      });
    }
    const claims = tokens.claims();
    if (!claims?.sub) {
      throw new OidcLoginError('sso_failed', 'The ID token carried no subject.');
    }
    return {
      issuer: String(claims.iss),
      subject: String(claims.sub),
      email: typeof claims.email === 'string' ? claims.email : null,
      isEmailVerified: claims.email_verified === true,
    };
  }

  private async findLinkedUserId(claims: OidcIdentityClaims): Promise<string | null> {
    const [row] = await this.db
      .select({ userId: identityLink.userId })
      .from(identityLink)
      .where(
        sql`${identityLink.issuer} = ${claims.issuer} and ${identityLink.subject} = ${claims.subject}`,
      )
      .limit(1);
    return row?.userId ?? null;
  }

  private async findUserIdByVerifiedEmail(claims: OidcIdentityClaims): Promise<string | null> {
    if (claims.email === null) {
      return null;
    }
    const [row] = await this.db
      .select({ id: userAccount.id })
      .from(userAccount)
      .where(sql`lower(${userAccount.email}) = lower(${claims.email})`)
      .limit(1);
    return row?.id ?? null;
  }

  /** Loads the account, rejecting the login when it is disabled or gone. */
  private async loadActiveUser(userId: string, claims: OidcIdentityClaims): Promise<UserProfile> {
    const user = await this.users.findById(userId);
    if (!user) {
      throw new OidcLoginError(
        'sso_no_account',
        `Account ${userId} for SSO identity ${claims.subject} is disabled or missing.`,
      );
    }
    await this.touchLink(claims);
    return user;
  }

  private async createLink(userId: string, claims: OidcIdentityClaims): Promise<void> {
    await this.db.insert(identityLink).values({
      id: uuidv7(),
      userId,
      issuer: claims.issuer,
      subject: claims.subject,
      email: claims.email,
    });
  }

  private async touchLink(claims: OidcIdentityClaims): Promise<void> {
    await this.db
      .update(identityLink)
      .set({ lastLoginAt: new Date() })
      .where(
        sql`${identityLink.issuer} = ${claims.issuer} and ${identityLink.subject} = ${claims.subject}`,
      );
  }

  private discover(): Promise<oidc.Configuration> {
    this.discoveryPromise ??= oidc
      .discovery(
        new URL(this.config.oidcIssuerUrl),
        this.config.oidcClientId,
        this.config.oidcClientSecret,
      )
      .catch((error: unknown) => {
        // Drop the failed attempt so the next login retries a recovered IdP.
        this.discoveryPromise = null;
        throw new OidcLoginError('sso_failed', 'Could not reach the identity provider.', {
          cause: error,
        });
      });
    return this.discoveryPromise;
  }
}
