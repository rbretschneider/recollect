import { inject, Injectable } from '@angular/core';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { filter } from 'rxjs';
import { AuthStateService } from './auth/auth-state.service';

const UPDATE_CHECK_MS = 5 * 60 * 1000;

/** Hidden longer than this and the access token is likely stale on wake. */
const STALE_AFTER_HIDDEN_MS = 5 * 60 * 1000;

/**
 * Deploys reach the user's screen by themselves. The Angular service worker
 * normally activates a new version only on the NEXT visit; here a ready
 * version reloads the app immediately, and we poll for updates while open.
 */
@Injectable({ providedIn: 'root' })
export class AppUpdateService {
  private readonly updates = inject(SwUpdate);
  private readonly auth = inject(AuthStateService);
  private hiddenAt: number | null = null;

  start(): void {
    // Waking from a suspend: refresh the session BEFORE the user taps, so
    // the first interaction never eats the 401-retry latency, and check for
    // a new app version whenever we come back to the foreground.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        this.hiddenAt = Date.now();
        return;
      }
      const hiddenFor = this.hiddenAt === null ? 0 : Date.now() - this.hiddenAt;
      this.hiddenAt = null;
      // Every return to foreground is a chance to catch a fresh deploy.
      this.checkForUpdate();
      if (hiddenFor > STALE_AFTER_HIDDEN_MS && this.auth.user() !== null) {
        void this.auth.tryRefresh();
      }
    });
    if (!this.updates.isEnabled) {
      return;
    }
    this.updates.versionUpdates
      .pipe(filter((event): event is VersionReadyEvent => event.type === 'VERSION_READY'))
      .subscribe(() => {
        void this.updates.activateUpdate().then(() => window.location.reload());
      });
    // Check right away and on a fixed cadence. NOT gated on appRef.isStable:
    // any long-lived timer (a slideshow, a poll) can keep the app from ever
    // reporting "stable", which would silently kill the update loop for an
    // open tab — exactly the case where a deploy needs to reach the user.
    this.checkForUpdate();
    setInterval(() => this.checkForUpdate(), UPDATE_CHECK_MS);
  }

  private checkForUpdate(): void {
    if (!this.updates.isEnabled) {
      return;
    }
    // Rejects if the SW isn't registered yet (early boot) — harmless, ignore.
    void this.updates.checkForUpdate().catch(() => undefined);
  }
}
