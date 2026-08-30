import { inject, Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { SwPush } from '@angular/service-worker';
import { firstValueFrom } from 'rxjs';

interface PushKeyResponse {
  enabled: boolean;
  publicKey: string;
  devices: number;
}

/**
 * Web Push opt-in for the installed PWA. The heavy lifting is the browser's
 * PushManager via Angular's SwPush; we just broker the VAPID key and persist
 * the subscription server-side. Everything degrades quietly when the browser
 * or the server hasn't got push configured.
 */
@Injectable({ providedIn: 'root' })
export class PushNotificationsService {
  private readonly swPush = inject(SwPush);
  private readonly http = inject(HttpClient);

  /** This browser can do Web Push and the service worker is live. */
  readonly supported =
    this.swPush.isEnabled && typeof Notification !== 'undefined' && 'PushManager' in window;
  /** The server has VAPID keys configured. */
  readonly serverEnabled = signal(false);
  /** This device currently has an active subscription. */
  readonly subscribed = signal(false);
  readonly busy = signal(false);

  private publicKey = '';

  /** Load server state + whether this device is already subscribed. */
  async refresh(): Promise<void> {
    if (!this.supported) {
      return;
    }
    try {
      const key = await firstValueFrom(this.http.get<PushKeyResponse>('/api/v1/push/key'));
      this.serverEnabled.set(key.enabled);
      this.publicKey = key.publicKey;
      const existing = await firstValueFrom(this.swPush.subscription);
      this.subscribed.set(existing !== null);
    } catch {
      this.serverEnabled.set(false);
    }
  }

  /** Ask for permission, subscribe this device, and persist it server-side. */
  async enable(): Promise<void> {
    if (!this.supported || !this.publicKey || this.busy()) {
      return;
    }
    this.busy.set(true);
    try {
      const sub = await this.swPush.requestSubscription({ serverPublicKey: this.publicKey });
      const json = sub.toJSON();
      await firstValueFrom(
        this.http.post<void>('/api/v1/push/subscribe', {
          endpoint: json.endpoint,
          keys: json.keys,
        }),
      );
      this.subscribed.set(true);
    } finally {
      this.busy.set(false);
    }
  }

  /** Drop this device's subscription both server-side and in the browser. */
  async disable(): Promise<void> {
    if (this.busy()) {
      return;
    }
    this.busy.set(true);
    try {
      const existing = await firstValueFrom(this.swPush.subscription);
      if (existing) {
        await firstValueFrom(
          this.http.post<void>('/api/v1/push/unsubscribe', { endpoint: existing.endpoint }),
        );
        await this.swPush.unsubscribe().catch(() => undefined);
      }
      this.subscribed.set(false);
    } finally {
      this.busy.set(false);
    }
  }

  /** Admin self-test: ask the server to push to this user's devices. */
  async sendTest(): Promise<number> {
    const result = await firstValueFrom(
      this.http.post<{ delivered: number }>('/api/v1/push/test', {}),
    );
    return result.delivered;
  }
}
