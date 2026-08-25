import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserProfile } from '../../users/user.types';
import { REQUIRED_GRANT_KEY } from '../decorators/require-grant.decorator';
import { REQUIRES_ADMIN_KEY } from '../decorators/require-admin.decorator';
import { hasGrant, Permission } from '../permission';

/**
 * Enforces @RequireGrant and @RequireAdmin metadata against the authenticated user.
 * Admin does not bypass grants for media (FRD §7): the two checks are independent.
 */
@Injectable()
export class GrantsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ user?: UserProfile }>();
    const user = request.user;
    if (!user) {
      return true; // Public route — AuthGuard did not attach a user.
    }
    this.checkAdmin(context, user);
    this.checkGrant(context, user);
    return true;
  }

  private checkAdmin(context: ExecutionContext, user: UserProfile): void {
    const requiresAdmin = this.reflector.getAllAndOverride<boolean>(REQUIRES_ADMIN_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (requiresAdmin === true && !user.isAdmin) {
      throw new ForbiddenException('This action requires an administrator.');
    }
  }

  private checkGrant(context: ExecutionContext, user: UserProfile): void {
    const required = this.reflector.getAllAndOverride<Permission>(REQUIRED_GRANT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (required && !hasGrant(user.permission, required)) {
      throw new ForbiddenException(`This action requires the '${required}' permission.`);
    }
  }
}
