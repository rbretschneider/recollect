import { Component, inject } from '@angular/core';
import { NavigationEnd, NavigationError, Router, RouterOutlet } from '@angular/router';

/** sessionStorage flag preventing a reload loop when recovery itself fails. */
const RELOAD_GUARD_KEY = 'rc-chunk-reload';

@Component({
  imports: [RouterOutlet],
  selector: 'app-root',
  template: '<router-outlet />',
})
export class App {
  private readonly router = inject(Router);

  constructor() {
    // After a deploy, the cached index may reference lazy chunks that no
    // longer exist; navigation then fails and the app goes black. A full
    // reload fetches the fresh index and recovers — once, not in a loop.
    this.router.events.subscribe((event) => {
      if (event instanceof NavigationError && this.isStaleChunkError(event.error)) {
        if (sessionStorage.getItem(RELOAD_GUARD_KEY) === null) {
          sessionStorage.setItem(RELOAD_GUARD_KEY, '1');
          window.location.assign(event.url);
        }
      } else if (event instanceof NavigationEnd) {
        sessionStorage.removeItem(RELOAD_GUARD_KEY);
      }
    });
  }

  private isStaleChunkError(error: unknown): boolean {
    const message = String((error as Error)?.message ?? error ?? '');
    return (
      message.includes('Failed to fetch dynamically imported module') ||
      message.includes('ChunkLoadError') ||
      message.includes('error loading dynamically imported module')
    );
  }
}
