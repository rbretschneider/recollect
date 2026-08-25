import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { UserProfile } from '../../users/user.types';

/** Injects the authenticated {@link UserProfile} attached to the request by the auth guard. */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): UserProfile => {
  const request = ctx.switchToHttp().getRequest<{ user: UserProfile }>();
  return request.user;
});
