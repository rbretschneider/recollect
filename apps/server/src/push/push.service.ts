import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { and, eq } from 'drizzle-orm';
import webpush from 'web-push';
import { APP_CONFIG } from '../config/app-config';
import type { AppConfig } from '../config/app-config';
import { DATABASE } from '../database/database.module';
import type { Database } from '../database/database.module';
import { pushSubscription } from '../database/schema';

/** The browser-supplied Web Push subscription (PushSubscription.toJSON()). */
export interface PushSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** A notification to deliver; mirrors the ngsw push message shape. */
export interface PushPayload {
  title: string;
  body: string;
  /** Where tapping the notification should open the app. */
  url?: string;
}

/**
 * Web Push (VAPID) delivery to installed PWAs. Self-hosted — no third party.
 * Disabled (a no-op) until VAPID keys are configured, so the app runs fine
 * without them. Sending is best-effort and prunes dead subscriptions.
 */
@Injectable()
export class PushService implements OnModuleInit {
  private readonly logger = new Logger(PushService.name);
  private enabled = false;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DATABASE) private readonly db: Database,
  ) {}

  onModuleInit(): void {
    if (this.config.vapidPublicKey && this.config.vapidPrivateKey) {
      webpush.setVapidDetails(
        this.config.vapidSubject,
        this.config.vapidPublicKey,
        this.config.vapidPrivateKey,
      );
      this.enabled = true;
      this.logger.log('Web Push enabled (VAPID configured).');
    } else {
      this.logger.log('Web Push disabled — no VAPID keys configured.');
    }
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /** The VAPID public key the browser needs to create a subscription. */
  get publicKey(): string {
    return this.config.vapidPublicKey;
  }

  /** Store (or refresh) a subscription, keyed by its unique endpoint. */
  async subscribe(
    userId: string,
    input: PushSubscriptionInput,
    userAgent: string | null,
  ): Promise<void> {
    await this.db
      .insert(pushSubscription)
      .values({
        id: randomUUID(),
        userId,
        endpoint: input.endpoint,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
        userAgent,
      })
      .onConflictDoUpdate({
        target: pushSubscription.endpoint,
        set: {
          userId,
          p256dh: input.keys.p256dh,
          auth: input.keys.auth,
          userAgent,
        },
      });
  }

  /** Remove one subscription (this browser opted out or the endpoint died). */
  async unsubscribe(userId: string, endpoint: string): Promise<void> {
    await this.db
      .delete(pushSubscription)
      .where(and(eq(pushSubscription.userId, userId), eq(pushSubscription.endpoint, endpoint)));
  }

  /** How many devices this user has subscribed (for the Settings toggle state). */
  async countForUser(userId: string): Promise<number> {
    const rows = await this.db
      .select({ id: pushSubscription.id })
      .from(pushSubscription)
      .where(eq(pushSubscription.userId, userId));
    return rows.length;
  }

  /**
   * Deliver a notification to every device a user has subscribed. Dead
   * endpoints (404/410) are pruned. Never throws — notifications are a garnish.
   */
  async sendToUser(userId: string, payload: PushPayload): Promise<number> {
    if (!this.enabled) {
      return 0;
    }
    const subs = await this.db
      .select()
      .from(pushSubscription)
      .where(eq(pushSubscription.userId, userId));
    const body = JSON.stringify({
      notification: {
        title: payload.title,
        body: payload.body,
        data: { url: payload.url ?? '/' },
      },
    });
    let delivered = 0;
    for (const sub of subs) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          body,
        );
        delivered++;
      } catch (error) {
        const statusCode = (error as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          await this.db
            .delete(pushSubscription)
            .where(eq(pushSubscription.endpoint, sub.endpoint));
        } else {
          this.logger.warn(`Push to ${sub.endpoint} failed: ${(error as Error).message}`);
        }
      }
    }
    return delivered;
  }
}
