import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Patch, Post } from '@nestjs/common';
import { IsBoolean, IsObject, IsOptional, IsString, Matches, MinLength } from 'class-validator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequireAdmin } from '../auth/decorators/require-admin.decorator';
import type { UserProfile } from '../users/user.types';
import { DailyPref, PushService } from './push.service';

/** Body for saving a browser's push subscription (PushSubscription.toJSON()). */
export class SubscribeRequestDto {
  @IsString()
  @MinLength(1)
  endpoint!: string;

  @IsObject()
  keys!: { p256dh: string; auth: string };

  /** The device's IANA zone, so the daily push fires at local 07:30. */
  @IsOptional()
  @IsString()
  timezone?: string;
}

/** Body for dropping a subscription by its endpoint. */
export class UnsubscribeRequestDto {
  @IsString()
  @MinLength(1)
  endpoint!: string;
}

/** Body for the daily look-back settings. */
export class DailyPrefDto {
  @IsBoolean()
  dailyEnabled!: boolean;

  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  dailyTime!: string;

  @IsString()
  @MinLength(1)
  timezone!: string;
}

/** Web Push subscription management + a self-test. */
@Controller('push')
export class PushController {
  constructor(private readonly push: PushService) {}

  /** The VAPID public key + whether push is configured at all. */
  @Get('key')
  async key(
    @CurrentUser() user: UserProfile,
  ): Promise<{ enabled: boolean; publicKey: string; devices: number }> {
    return {
      enabled: this.push.isEnabled,
      publicKey: this.push.publicKey,
      devices: await this.push.countForUser(user.id),
    };
  }

  @Post('subscribe')
  @HttpCode(HttpStatus.NO_CONTENT)
  async subscribe(
    @Body() body: SubscribeRequestDto,
    @CurrentUser() user: UserProfile,
    @Headers('user-agent') userAgent?: string,
  ): Promise<void> {
    await this.push.subscribe(user.id, body, userAgent ?? null, body.timezone);
  }

  /** This user's daily look-back settings. */
  @Get('daily')
  async getDaily(@CurrentUser() user: UserProfile): Promise<DailyPref> {
    return this.push.getDailyPref(user.id);
  }

  @Patch('daily')
  @HttpCode(HttpStatus.NO_CONTENT)
  async setDaily(
    @Body() body: DailyPrefDto,
    @CurrentUser() user: UserProfile,
  ): Promise<void> {
    await this.push.setDailyPref(user.id, body);
  }

  @Post('unsubscribe')
  @HttpCode(HttpStatus.NO_CONTENT)
  async unsubscribe(
    @Body() body: UnsubscribeRequestDto,
    @CurrentUser() user: UserProfile,
  ): Promise<void> {
    await this.push.unsubscribe(user.id, body.endpoint);
  }

  /** Fire a test notification to this user's own devices (verify the pipe). */
  @RequireAdmin()
  @Post('test')
  async test(@CurrentUser() user: UserProfile): Promise<{ delivered: number }> {
    const delivered = await this.push.sendToUser(user.id, {
      title: 'Recollect',
      body: 'Push notifications are working 🎉',
      url: '/',
    });
    return { delivered };
  }
}
