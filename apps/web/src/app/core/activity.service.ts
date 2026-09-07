import { computed, effect, inject, Injectable, signal } from '@angular/core';
import { LibraryApiService } from './api/library-api.service';
import { LibraryStatus } from './api/api-models';
import { AuthStateService } from './auth/auth-state.service';

/** While jobs are running, progress should feel live. */
const ACTIVE_POLL_MS = 3000;
/** When nothing is queued there is nothing to narrate - just stay current. */
const IDLE_POLL_MS = 30_000;

/**
 * One app-wide poller for background activity, so every surface (top bar,
 * drawer, settings, memories) reports the same live truth about indexing.
 */
@Injectable({ providedIn: 'root' })
export class ActivityService {
  private readonly libraryApi = inject(LibraryApiService);
  private readonly auth = inject(AuthStateService);
  private timer: ReturnType<typeof setTimeout> | null = null;
  /**
   * Guards the self-rescheduling loop. Both the auth effect and the visibility
   * listener can call start(); without this, each extra call would fork a
   * second chain of timers that never merges back.
   */
  private looping = false;

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
    // A backgrounded tab has nobody to show progress to. Polling it anyway
    // holds the phone's radio open and takes bandwidth from whatever the user
    // actually switched to. Coming back is the moment to get fresh numbers.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.auth.user() !== null) {
        this.start();
      } else {
        this.suspend();
      }
    });
  }

  private start(): void {
    if (this.looping || document.visibilityState !== 'visible') {
      return;
    }
    this.looping = true;
    void this.poll();
  }

  /** Stops the timer but keeps the last reading on screen. */
  private suspend(): void {
    this.looping = false;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private stop(): void {
    this.suspend();
    this.status.set(null);
  }

  /**
   * Re-arms at a pace that matches what is happening. An idle library needs a
   * heartbeat, not a stopwatch: at three seconds this was ~1,200 requests an
   * hour per client, each one previously a full scan of the job table, to
   * report that nothing had changed.
   */
  private schedule(): void {
    if (!this.looping || document.visibilityState !== 'visible' || this.auth.user() === null) {
      this.looping = false;
      this.timer = null;
      return;
    }
    const delay = this.isWorking() ? ACTIVE_POLL_MS : IDLE_POLL_MS;
    this.timer = setTimeout(() => void this.poll(), delay);
  }

  private async poll(): Promise<void> {
    try {
      this.status.set(await this.libraryApi.getStatus());
    } catch {
      // Keep the last known status; the next poll may recover.
    } finally {
      this.schedule();
    }
  }
}
