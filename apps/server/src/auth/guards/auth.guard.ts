import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { UsersService } from '../../users/users.service';
import { UserProfile } from '../../users/user.types';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ACCESS_COOKIE } from '../auth-cookies';
import { TokenService } from '../token.service';

/**
 * Global authentication guard. Reads the access token from the httpOnly session
 * cookie, verifies it, and attaches the fresh {@link UserProfile} to the request
 * so downstream guards always see current grants. Routes marked @Public() skip it.
 *
 * Cookie-based auth (SameSite=Lax) is a deliberate deviation from bearer headers:
 * `<img>` thumbnail requests cannot carry an Authorization header, and Lax cookies
 * are not sent on cross-site POSTs, which covers CSRF for this same-origin app.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly users: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.isPublicRoute(context)) {
      return true;
    }
    const request = context.switchToHttp().getRequest<Request & { user?: UserProfile }>();
    const token = (request.cookies as Record<string, string> | undefined)?.[ACCESS_COOKIE];
    if (!token) {
      throw new UnauthorizedException('Not signed in.');
    }
    const verified = await this.tokens.verifyAccessToken(token);
    if (!verified) {
      throw new UnauthorizedException('Session expired.');
    }
    const user = await this.users.findById(verified.userId);
    if (!user) {
      throw new UnauthorizedException('Account is no longer active.');
    }
    // A password change or "sign out everywhere" bumps the account's version,
    // so an access token minted before it is dead immediately — not after its
    // 15-minute lifetime.
    if (verified.tokenVersion !== user.tokenVersion) {
      throw new UnauthorizedException('Session expired.');
    }
    // A forced password change blocks everything except the auth endpoints
    // themselves (change password, who-am-I, logout). The web app routes the
    // user to the change screen off this error code.
    if (user.mustChangePassword && !request.path.startsWith('/api/v1/auth')) {
      throw new ForbiddenException({
        message: 'Password change required.',
        code: 'PASSWORD_CHANGE_REQUIRED',
      });
    }
    request.user = user;
    return true;
  }

  private isPublicRoute(context: ExecutionContext): boolean {
    return (
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) === true
    );
  }
}
