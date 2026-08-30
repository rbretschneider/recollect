import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { IsObject, IsString, MinLength } from 'class-validator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequireAdmin } from '../auth/decorators/require-admin.decorator';
import type { UserProfile } from '../users/user.types';
import { PushService } from './push.service';

/** Body for saving a browser's push subscription (PushSubscription.toJSON()). */
export class SubscribeRequestDto {
  @IsString()
  @MinLength(1)
  endpoint!: string;

  @IsObject()
  keys!: { p256dh: string; auth: string };
}

/** Body for dropping a subscription by its endpoint. */
export class UnsubscribeRequestDto {
  @IsString()
  @MinLength(1)
  endpoint!: string;
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
    await this.push.subscribe(user.id, body, userAgent ?? null);
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
