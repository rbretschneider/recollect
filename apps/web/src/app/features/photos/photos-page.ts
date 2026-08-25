import {
  AfterViewInit,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  OnDestroy,
  signal,
  viewChild,
} from '@angular/core';
import { LibraryApiService } from '../../core/api/library-api.service';
import { PhotosApiService } from '../../core/api/photos-api.service';
import { LibraryStatus, TimelineAsset } from '../../core/api/api-models';
import { AuthStateService } from '../../core/auth/auth-state.service';

/** One day's worth of photos in the grid. */
interface DayGroup {
  day: string;
  label: string;
  items: TimelineAsset[];
}

const PAGE_SIZE = 100;
const STATUS_POLL_MS = 4000;

/** The main photo timeline: grid grouped by day with infinite scroll. */
@Component({
  selector: 'app-photos-page',
  imports: [],
  templateUrl: './photos-page.html',
  styleUrl: './photos-page.scss',
})
export class PhotosPage implements AfterViewInit, OnDestroy {
  private readonly photosApi = inject(PhotosApiService);
  private readonly libraryApi = inject(LibraryApiService);
  private readonly auth = inject(AuthStateService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly sentinel = viewChild.required<ElementRef<HTMLElement>>('sentinel');
  private observer: IntersectionObserver | null = null;
  private statusTimer: ReturnType<typeof setInterval> | null = null;
  private nextCursor: string | null = null;
  private hasLoadedFirstPage = false;

  readonly items = signal<TimelineAsset[]>([]);
  readonly isLoading = signal(false);
  readonly isComplete = signal(false);
  readonly status = signal<LibraryStatus | null>(null);
  readonly userName = computed(() => this.auth.user()?.displayName ?? '');

  readonly groups = computed<DayGroup[]>(() => this.groupByDay(this.items()));
  readonly pendingCount = computed(() => {
    const status = this.status();
    return status ? status.queuedJobs + status.runningJobs : 0;
  });

  ngAfterViewInit(): void {
    // First page loads eagerly; the observer only paginates from there.
    void this.loadMore();
    this.observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        void this.loadMore();
      }
    });
    this.observer.observe(this.sentinel().nativeElement);
    void this.pollStatus();
    this.statusTimer = setInterval(() => void this.pollStatus(), STATUS_POLL_MS);
    this.destroyRef.onDestroy(() => this.ngOnDestroy());
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
    this.observer = null;
    if (this.statusTimer !== null) {
      clearInterval(this.statusTimer);
      this.statusTimer = null;
    }
  }

  thumbUrl(asset: TimelineAsset): string {
    return this.photosApi.thumbnailUrl(asset.id, 240);
  }

  async loadMore(): Promise<void> {
    if (this.isLoading() || this.isComplete()) {
      return;
    }
    this.isLoading.set(true);
    try {
      const page = await this.photosApi.getTimelinePage(this.nextCursor, PAGE_SIZE);
      this.items.update((existing) => [...existing, ...page.items]);
      this.nextCursor = page.nextCursor;
      this.hasLoadedFirstPage = true;
      if (page.nextCursor === null) {
        this.isComplete.set(true);
      }
    } finally {
      this.isLoading.set(false);
    }
  }

  get showEmptyState(): boolean {
    return this.hasLoadedFirstPage && this.items().length === 0 && this.pendingCount() === 0;
  }

  private async pollStatus(): Promise<void> {
    try {
      const previousPending = this.pendingCount();
      this.status.set(await this.libraryApi.getStatus());
      if (previousPending > 0 && this.pendingCount() === 0) {
        await this.refreshFromStart();
      }
    } catch {
      // Status is a nicety; keep the grid usable when polling fails.
    }
  }

  /** Reloads the first page after indexing finishes so fresh photos appear. */
  private async refreshFromStart(): Promise<void> {
    this.nextCursor = null;
    this.isComplete.set(false);
    this.items.set([]);
    await this.loadMore();
  }

  private groupByDay(items: TimelineAsset[]): DayGroup[] {
    const groups: DayGroup[] = [];
    let current: DayGroup | null = null;
    for (const item of items) {
      if (current === null || current.day !== item.capturedDay) {
        current = { day: item.capturedDay, label: this.formatDay(item.capturedDay), items: [] };
        groups.push(current);
      }
      current.items.push(item);
    }
    return groups;
  }

  private formatDay(day: string): string {
    const date = new Date(`${day}T12:00:00`);
    return new Intl.DateTimeFormat(undefined, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    }).format(date);
  }
}
