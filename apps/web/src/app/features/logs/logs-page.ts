import { AfterViewInit, Component, DestroyRef, ElementRef, inject, OnInit, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SystemApiService } from '../../core/api/system-api.service';
import { ActivitySpinner } from '../../shared/activity-spinner';
import { BottomNav } from '../../shared/bottom-nav';

const TAIL_LINES = 500;
const REFRESH_MS = 5000;

/** Live tail of the server log, with download (admin). */
@Component({
  selector: 'app-logs-page',
  imports: [ActivitySpinner, BottomNav, RouterLink],
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
    const { lines } = await this.api.tailLogs(TAIL_LINES);
    this.lines.set(lines);
    this.isLoaded.set(true);
    if (this.isFollowing()) {
      queueMicrotask(() => this.scrollToEnd());
    }
  }

  private scrollToEnd(): void {
    const element = this.scroller().nativeElement;
    element.scrollTop = element.scrollHeight;
  }
}
