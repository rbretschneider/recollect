import { ApplicationRef, inject, Injectable } from '@angular/core';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { filter, first } from 'rxjs';
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
  private readonly appRef = inject(ApplicationRef);
  private readonly auth = inject(AuthStateService);
  private hiddenAt: number | null = null;

  start(): void {
    // Waking from a suspend: refresh the session BEFORE the user taps, so
    // the first interaction never eats the 401-retry latency, and check for
    // a new app version while we're at it.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        this.hiddenAt = Date.now();
        return;
      }
      const hiddenFor = this.hiddenAt === null ? 0 : Date.now() - this.hiddenAt;
      this.hiddenAt = null;
      if (hiddenFor > STALE_AFTER_HIDDEN_MS && this.auth.user() !== null) {
        void this.auth.tryRefresh();
        if (this.updates.isEnabled) {
          void this.updates.checkForUpdate();
        }
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
    // First check once the app settles, then keep checking while it stays open.
    this.appRef.isStable.pipe(first((stable) => stable)).subscribe(() => {
      void this.updates.checkForUpdate();
      setInterval(() => void this.updates.checkForUpdate(), UPDATE_CHECK_MS);
    });
  }
}
