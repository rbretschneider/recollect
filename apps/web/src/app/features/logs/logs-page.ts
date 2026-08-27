import { AfterViewInit, Component, DestroyRef, ElementRef, inject, OnInit, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SystemApiService } from '../../core/api/system-api.service';
import { ActivitySpinner } from '../../shared/activity-spinner';
import { BackButton } from '../../shared/back-button';
import { BottomNav } from '../../shared/bottom-nav';

const TAIL_LINES = 500;
const REFRESH_MS = 5000;

/** Live tail of the server log, with download (admin). */
@Component({
  selector: 'app-logs-page',
  imports: [BackButton, ActivitySpinner, BottomNav, RouterLink],
  templateUrl: './logs-page.html',
  styleUrl: './logs-page.scss',
})
export class LogsPage implements OnInit, AfterViewInit {
  private readonly api = inject(SystemApiService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly scroller = viewChild.required<ElementRef<HTMLElement>>('scroller');
  private timer: ReturnType<typeof setInterval> | null = null;

  readonly lines = signal<string[]>([]);
  readonly isLoaded = signal(false);
  readonly isFollowing = signal(true);
  readonly error = signal<string | null>(null);

  get downloadUrl(): string {
    return this.api.logDownloadUrl;
  }

  ngOnInit(): void {
    void this.refresh();
    this.timer = setInterval(() => {
      if (this.isFollowing()) {
        void this.refresh();
      }
    }, REFRESH_MS);
    this.destroyRef.onDestroy(() => {
      if (this.timer !== null) {
        clearInterval(this.timer);
      }
    });
  }

  ngAfterViewInit(): void {
    this.scrollToEnd();
  }

  toggleFollowing(): void {
    this.isFollowing.update((value) => !value);
    if (this.isFollowing()) {
      void this.refresh();
    }
  }

  async refresh(): Promise<void> {
    try {
      const { lines } = await this.api.tailLogs(TAIL_LINES);
      this.lines.set(lines ?? []);
      this.error.set(null);
      if (this.isFollowing()) {
        queueMicrotask(() => this.scrollToEnd());
      }
    } catch (caught) {
      const status = (caught as { status?: number }).status;
      this.error.set(
        status === 403 || status === 401
          ? 'Logs are only available to admins.'
          : `Couldn't load logs${status ? ` (HTTP ${status})` : ''}. Retrying…`,
      );
    } finally {
      this.isLoaded.set(true);
    }
  }

  private scrollToEnd(): void {
    const element = this.scroller().nativeElement;
    element.scrollTop = element.scrollHeight;
  }
}
