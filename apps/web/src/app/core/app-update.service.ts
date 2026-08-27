import { ApplicationRef, inject, Injectable } from '@angular/core';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { filter, first } from 'rxjs';

const UPDATE_CHECK_MS = 5 * 60 * 1000;

/**
 * Deploys reach the user's screen by themselves. The Angular service worker
 * normally activates a new version only on the NEXT visit; here a ready
 * version reloads the app immediately, and we poll for updates while open.
 */
@Injectable({ providedIn: 'root' })
export class AppUpdateService {
  private readonly updates = inject(SwUpdate);
  private readonly appRef = inject(ApplicationRef);

  start(): void {
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
