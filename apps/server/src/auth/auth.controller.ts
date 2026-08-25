import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
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
import { LoginRequestDto } from './dto/login-request.dto';

/** Session endpoints: login, refresh, logout, current user. */
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() body: LoginRequestDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ user: UserProfile }> {
    const issued = await this.auth.login(body.email, body.password, body.deviceLabel);
    setAuthCookies(res, issued.accessToken, issued.refreshToken);
    return { user: issued.user };
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
