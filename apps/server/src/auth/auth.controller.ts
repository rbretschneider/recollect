import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { UserProfile } from '../users/user.types';
import { AuthService } from './auth.service';
import { clearAuthCookies, REFRESH_COOKIE, setAuthCookies } from './auth-cookies';
import { CurrentUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import { ChangePasswordRequestDto } from './dto/change-password-request.dto';
import { LoginRequestDto } from './dto/login-request.dto';
import { LoginThrottleService } from './login-throttle.service';
import { RequireAdmin } from './decorators/require-admin.decorator';
import { ResetPasswordRequestDto } from '../users/dto/reset-password-request.dto';

/** Session endpoints: login, refresh, logout, current user. */
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly throttle: LoginThrottleService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() body: LoginRequestDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ user: UserProfile }> {
    const ip = req.ip ?? 'unknown';
    this.throttle.assertAllowed(ip, body.email);
    let issued;
    try {
      issued = await this.auth.login(body.email, body.password, body.deviceLabel);
    } catch (error) {
      this.throttle.recordFailure(ip, body.email);
      throw error;
    }
    this.throttle.recordSuccess(ip, body.email);
    setAuthCookies(res, issued.accessToken, issued.refreshToken);
    return { user: issued.user };
  }

  /** Change own password; revokes every session and signs this device back in. */
  @Post('password')
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @CurrentUser() user: UserProfile,
    @Body() body: ChangePasswordRequestDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ user: UserProfile }> {
    const issued = await this.auth.changePassword(
      user.id,
      body.currentPassword,
      body.newPassword,
    );
    setAuthCookies(res, issued.accessToken, issued.refreshToken);
    return { user: issued.user };
  }

  /** Admin reset of a member's password: forced change at next login, sessions dead. */
  @RequireAdmin()
  @Post('users/:userId/password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async resetMemberPassword(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() body: ResetPasswordRequestDto,
  ): Promise<void> {
    await this.auth.adminResetPassword(userId, body.password);
  }

  /** Panic button: revoke every session everywhere, this device included. */
  @Post('logout-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logoutAll(
    @CurrentUser() user: UserProfile,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.revokeAllSessions(user.id);
    clearAuthCookies(res);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ user: UserProfile }> {
    const token = this.readRefreshCookie(req);
    const issued = await this.auth.refresh(token);
    setAuthCookies(res, issued.accessToken, issued.refreshToken);
    return { user: issued.user };
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const token = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
    if (token) {
      await this.auth.logout(token);
    }
    clearAuthCookies(res);
  }

  @Get('me')
  me(@CurrentUser() user: UserProfile): { user: UserProfile } {
    return { user };
  }

  private readRefreshCookie(req: Request): string {
    const token = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
    if (!token) {
      throw new UnauthorizedException('No session to refresh.');
    }
    return token;
  }
}
