import { computed, effect, inject, Injectable, signal } from '@angular/core';
import { LibraryApiService } from './api/library-api.service';
import { LibraryStatus } from './api/api-models';
import { AuthStateService } from './auth/auth-state.service';

const POLL_MS = 3000;

/**
 * One app-wide poller for background activity, so every surface (top bar,
 * drawer, settings, memories) reports the same live truth about indexing.
 */
@Injectable({ providedIn: 'root' })
export class ActivityService {
  private readonly libraryApi = inject(LibraryApiService);
  private readonly auth = inject(AuthStateService);
  private timer: ReturnType<typeof setInterval> | null = null;

  readonly status = signal<LibraryStatus | null>(null);

  /** Jobs actually executing right now. */
  readonly runningCount = computed(() => this.status()?.runningJobs ?? 0);

  /** Everything still ahead of the workers (queued + running). */
  readonly pendingCount = computed(() => {
    const status = this.status();
    return status ? status.queuedJobs + status.runningJobs : 0;
  });

  /** True while work is genuinely happening. */
  readonly isWorking = computed(() => this.pendingCount() > 0);

  /**
   * Import progress as "done / total" when a scan batch is in flight
   * (e.g. "3,041 / 29,583"), falling back to the plain pending count.
   */
  readonly progressLabel = computed(() => {
    const status = this.status();
    if (!status) {
      return '';
    }
    if (status.batchTotal > 0 && status.ingestPending > 0) {
      const done = Math.max(0, status.batchTotal - status.ingestPending);
      return `${done.toLocaleString()} / ${status.batchTotal.toLocaleString()}`;
    }
    return this.pendingCount().toLocaleString();
  });

  constructor() {
    effect(() => {
      if (this.auth.user() !== null) {
        this.start();
      } else {
        this.stop();
      }
    });
  }

  private start(): void {
    if (this.timer !== null) {
      return;
    }
    void this.poll();
    this.timer = setInterval(() => void this.poll(), POLL_MS);
  }

  private stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.status.set(null);
  }

  private async poll(): Promise<void> {
    try {
      this.status.set(await this.libraryApi.getStatus());
    } catch {
      // Keep the last known status; the next poll may recover.
    }
  }
}
