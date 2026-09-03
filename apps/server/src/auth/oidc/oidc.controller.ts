import { Controller, Get, Logger, NotFoundException, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from '../auth.service';
import { setAuthCookies } from '../auth-cookies';
import { Public } from '../decorators/public.decorator';
import { LoginThrottleService } from '../login-throttle.service';
import { OidcLoginError, OidcService } from './oidc.service';
import {
  clearOidcTransactionCookie,
  readOidcTransactionCookie,
  setOidcTransactionCookie,
} from './oidc-transaction-cookie';

const CALLBACK_PATH = '/api/v1/auth/oidc/callback';

/** Session label shown for SSO logins in any future session listing. */
const SSO_DEVICE_LABEL = 'SSO login';

/**
 * Browser-facing OIDC endpoints. These are top-level navigations, not XHR:
 * errors leave as redirects back to the login page with an `ssoError` code,
 * never as JSON the user would see raw.
 */
@Controller('auth/oidc')
export class OidcController {
  private readonly logger = new Logger(OidcController.name);

  constructor(
    private readonly oidc: OidcService,
    private readonly auth: AuthService,
    private readonly throttle: LoginThrottleService,
  ) {}

  /** Whether the login page should offer the SSO button, and its label. */
  @Public()
  @Get()
  availability(): { available: boolean; label: string } {
    return { available: this.oidc.isEnabled, label: this.oidc.buttonLabel };
  }

  /** Kicks off the IdP round-trip: remember the transaction, redirect out. */
  @Public()
  @Get('start')
  async start(@Req() req: Request, @Res() res: Response): Promise<void> {
    this.assertEnabled();
    this.throttle.assertAllowed(req.ip ?? 'unknown');
    const returnUrl = this.safeReturnPath(req.query.returnUrl);
    const started = await this.oidc.beginLogin(`${this.origin(req)}${CALLBACK_PATH}`, returnUrl);
    setOidcTransactionCookie(res, started.transaction);
    res.redirect(started.authorizationUrl);
  }

  /** Finishes the round-trip: validate, map to an account, sign in, land. */
  @Public()
  @Get('callback')
  async callback(@Req() req: Request, @Res() res: Response): Promise<void> {
    this.assertEnabled();
    this.throttle.assertAllowed(req.ip ?? 'unknown');
    const transaction = readOidcTransactionCookie(req);
    clearOidcTransactionCookie(res);
    if (!transaction) {
      // Expired or missing transaction (the cookie lives 5 minutes) — nothing
      // to validate the callback against, so the login starts over.
      res.redirect('/login?ssoError=sso_failed');
      return;
    }
    try {
      const callbackUrl = new URL(req.originalUrl, this.origin(req));
      const user = await this.oidc.completeLogin(callbackUrl, transaction);
      const issued = await this.auth.issueSessionFor(user, SSO_DEVICE_LABEL);
      setAuthCookies(res, issued.accessToken, issued.refreshToken);
      res.redirect(transaction.returnUrl);
    } catch (error) {
      if (!(error instanceof OidcLoginError)) {
        // OidcLoginError paths were already logged at the point of failure;
        // anything else reaching here is a bug worth the full stack.
        this.logger.error('Unexpected error completing SSO login', error as Error);
      }
      const code = error instanceof OidcLoginError ? error.code : 'sso_failed';
      res.redirect(`/login?ssoError=${code}`);
    }
  }

  private assertEnabled(): void {
    if (!this.oidc.isEnabled) {
      throw new NotFoundException('SSO is not configured.');
    }
  }

  private origin(req: Request): string {
    return `${req.protocol}://${req.get('host') ?? ''}`;
  }

  /** Only ever a same-origin app path — never an open redirect off-site. */
  private safeReturnPath(raw: unknown): string {
    return typeof raw === 'string' && raw.startsWith('/') && !raw.startsWith('//') ? raw : '/';
  }
}
