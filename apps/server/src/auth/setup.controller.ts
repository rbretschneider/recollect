import { Body, Controller, Get, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { UserProfile } from '../users/user.types';
import { AuthService } from './auth.service';
import { setAuthCookies } from './auth-cookies';
import { Public } from './decorators/public.decorator';
import { SetupRequestDto } from './dto/setup-request.dto';

/** First-run setup: create the initial admin account when no users exist. */
@Controller('setup')
export class SetupController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Get('status')
  async status(): Promise<{ needsSetup: boolean }> {
    return { needsSetup: await this.auth.needsSetup() };
  }

  @Public()
  @Post()
  async complete(
    @Body() body: SetupRequestDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ user: UserProfile }> {
    const issued = await this.auth.completeSetup(body.email, body.displayName, body.password);
    setAuthCookies(res, issued.accessToken, issued.refreshToken);
    return { user: issued.user };
  }
}
