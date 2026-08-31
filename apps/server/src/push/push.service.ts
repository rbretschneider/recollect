import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { and, eq, sql } from 'drizzle-orm';
import webpush from 'web-push';
import { APP_CONFIG } from '../config/app-config';
import type { AppConfig } from '../config/app-config';
import { DATABASE } from '../database/database.module';
import type { Database } from '../database/database.module';
import { notificationPref, pushSubscription } from '../database/schema';

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

/** The daily "years ago" look-back push settings for one user. */
export interface DailyPref {
  dailyEnabled: boolean;
  /** Local wall-clock "HH:MM". */
  dailyTime: string;
  timezone: string;
}

const DEFAULT_DAILY: DailyPref = { dailyEnabled: true, dailyTime: '07:30', timezone: 'UTC' };

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
    timezone?: string,
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
    // First device to enable notifications seeds the daily look-back on at
    // 07:30 in the device's own zone; the user can change it in Settings.
    await this.db
      .insert(notificationPref)
      .values({ userId, timezone: timezone ?? DEFAULT_DAILY.timezone })
      .onConflictDoNothing();
  }

  /** This user's daily look-back settings (defaults if never set). */
  async getDailyPref(userId: string): Promise<DailyPref> {
    const [row] = await this.db
      .select()
      .from(notificationPref)
      .where(eq(notificationPref.userId, userId));
    if (!row) {
      return DEFAULT_DAILY;
    }
    return { dailyEnabled: row.dailyEnabled, dailyTime: row.dailyTime, timezone: row.timezone };
  }

  /** Upsert this user's daily look-back settings. */
  async setDailyPref(userId: string, pref: DailyPref): Promise<void> {
    await this.db
      .insert(notificationPref)
      .values({
        userId,
        dailyEnabled: pref.dailyEnabled,
        dailyTime: pref.dailyTime,
        timezone: pref.timezone,
      })
      .onConflictDoUpdate({
        target: notificationPref.userId,
        set: {
          dailyEnabled: pref.dailyEnabled,
          dailyTime: pref.dailyTime,
          timezone: pref.timezone,
          updatedAt: new Date(),
        },
      });
  }

  /** Enabled daily-look-back users who have at least one live subscription. */
  async dailyCandidates(): Promise<
    Array<{
      userId: string;
      dailyTime: string;
      timezone: string;
      lastSentOn: string | null;
      lastMomentKeys: string | null;
    }>
  > {
    const rows = await this.db.execute<{
      user_id: string;
      daily_time: string;
      timezone: string;
      last_sent_on: string | null;
      last_moment_keys: string | null;
    }>(sql`
      select p.user_id, p.daily_time, p.timezone,
             p.last_sent_on::text as last_sent_on, p.last_moment_keys
      from notification_pref p
      where p.daily_enabled = true
        and exists (select 1 from push_subscription s where s.user_id = p.user_id)
    `);
    return rows.rows.map((row) => ({
      userId: row.user_id,
      dailyTime: row.daily_time,
      timezone: row.timezone,
      lastSentOn: row.last_sent_on,
      lastMomentKeys: row.last_moment_keys,
    }));
  }

  /** Record that today's local date was handled, so it never double-fires. */
  async markDailySent(userId: string, localDate: string): Promise<void> {
    await this.db
      .update(notificationPref)
      .set({ lastSentOn: localDate })
      .where(eq(notificationPref.userId, userId));
  }

  /** Remember the moment set we just pushed, to skip an identical day next time. */
  async recordDailyPush(userId: string, momentKeys: string): Promise<void> {
    await this.db
      .update(notificationPref)
      .set({ lastMomentKeys: momentKeys })
      .where(eq(notificationPref.userId, userId));
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
    const url = payload.url ?? '/';
    const body = JSON.stringify({
      notification: {
        title: payload.title,
        body: payload.body,
        // onActionClick is what makes the ngsw service worker OPEN/focus the PWA
        // when the app is closed. Without it a tap does nothing but dismiss.
        // navigate…Open focuses an existing window (and routes it) or opens one.
        data: {
          url,
          onActionClick: { default: { operation: 'navigateLastFocusedOrOpen', url } },
        },
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
