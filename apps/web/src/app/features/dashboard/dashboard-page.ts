import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { assetThumbUrl } from '../../core/api/photos-api.service';
import { HttpClient } from '@angular/common/http';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AlbumsApiService } from '../../core/api/albums-api.service';
import { MemoriesApiService } from '../../core/api/memories-api.service';
import { InboxSuggestion, MemorySummary, TimelineAsset, toViewerAsset } from '../../core/api/api-models';
import { AuthStateService } from '../../core/auth/auth-state.service';
import { AppTopbar } from '../../shared/app-topbar';
import { PageLoading } from '../../shared/page-loading';
import { LoadError } from '../../shared/load-error';
import { ToastService } from '../../shared/toast.service';
import { Icon } from '../../shared/icon';
import { AssetViewer } from '../viewer/asset-viewer';
import { SlideshowOverlay, SlideItem } from './slideshow-overlay';

interface OnThisDayYear {
  year: number;
  items: Array<{ id: string; mediaType: 'image' | 'video' }>;
}

/**
 * Home. The first screen after sign-in: on-this-day through the years,
 * fresh memory suggestions, and the latest memories to jump back into.
 */
@Component({
  selector: 'app-dashboard-page',
  imports: [AppTopbar, AssetViewer, PageLoading, LoadError, RouterLink, SlideshowOverlay, Icon],
  templateUrl: './dashboard-page.html',
  styleUrl: './dashboard-page.scss',
})
export class DashboardPage implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly memoriesApi = inject(MemoriesApiService);
  private readonly albumsApi = inject(AlbumsApiService);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthStateService);
  private readonly toasts = inject(ToastService);

  readonly onThisDay = signal<OnThisDayYear[]>([]);
  readonly suggestions = signal<InboxSuggestion[]>([]);
  readonly recentMemories = signal<MemorySummary[]>([]);
  /** The newest photos to land in the library, by when they were added. */
  readonly recentlyAdded = signal<Array<{ id: string; mediaType: 'image' | 'video' }>>([]);
  /** The photo content is the primary content — its spinner clears the moment
   * the two photo endpoints answer, without waiting on memories/suggestions. */
  readonly photosPending = signal(true);
  /** True once all four sections have settled, so the empty state can't flash. */
  readonly allLoaded = signal(false);
  /** Every section errored — show a retry rather than a misleading "empty". */
  readonly loadFailed = signal(false);

  /** Viewer over a strip (a year's photos, or the recently-added row). */
  readonly viewerAssets = signal<TimelineAsset[]>([]);
  readonly viewerIndex = signal<number | null>(null);

  /** Opens the recently-added row in the fullscreen viewer at the tapped photo. */
  openRecent(index: number): void {
    this.viewerAssets.set(this.recentlyAdded().map((item) => toViewerAsset(item.id, item.mediaType)));
    this.viewerIndex.set(index);
  }

  readonly todayLabel = new Date().toLocaleDateString(undefined, {
    month: 'long',
    day: 'numeric',
  });

  readonly greeting = computed(() => {
    const name = this.auth.user()?.displayName.split(' ')[0] ?? '';
    const hour = new Date().getHours();
    const part = hour < 5 ? 'night owl' : hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
    return part === 'night owl' ? `Up late, ${name}?` : `Good ${part}, ${name}`;
  });

  ngOnInit(): void {
    void this.load();
  }

  thumbUrl(assetId: string, size: 240 | 720 = 240): string {
    return assetThumbUrl(assetId, size);
  }

  yearsAgo(year: number): string {
    const diff = new Date().getFullYear() - year;
    if (diff === 0) {
      return 'Today';
    }
    return diff === 1 ? 'A year ago' : `${diff} years ago`;
  }

  spanLabel(item: InboxSuggestion | MemorySummary): string {
    const start = new Date(item.startAt);
    return start.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  /** The polaroid stack was tapped: run that year as a slideshow. */
  readonly slideshowItems = signal<SlideItem[] | null>(null);
  readonly slideshowTitle = signal('');

  openSlideshow(group: OnThisDayYear): void {
    this.slideshowTitle.set(`${this.yearsAgo(group.year)} · ${group.year}`);
    this.slideshowItems.set(group.items);
  }

  closeSlideshow(): void {
    this.slideshowItems.set(null);
  }

  /** Up to four fanned photos per stack; the rest wait for the show. */
  stackPreview(group: OnThisDayYear): Array<{ id: string; mediaType: string }> {
    return group.items.slice(0, 4);
  }

  /** Which year's save-as-album is in flight (per-stack busy state). */
  readonly savingAlbumYear = signal<number | null>(null);

  /** One tap turns a year's pile into a real album and opens it. */
  async saveAsAlbum(group: OnThisDayYear): Promise<void> {
    if (this.savingAlbumYear() !== null) {
      return;
    }
    this.savingAlbumYear.set(group.year);
    try {
      const dayLabel = new Date().toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
      const { albumId } = await this.albumsApi.create(
        `${dayLabel}, ${group.year}`,
        group.items.map((item) => item.id),
      );
      await this.router.navigate(['/albums', albumId]);
    } catch {
      this.toasts.error('Couldn’t create that album.', {
        label: 'Retry',
        run: () => void this.saveAsAlbum(group),
      });
    } finally {
      this.savingAlbumYear.set(null);
    }
  }

  closeViewer(): void {
    this.viewerIndex.set(null);
  }

  onViewerDeleted(assetId: string): void {
    this.viewerAssets.update((assets) => assets.filter((asset) => asset.id !== assetId));
  }

  protected load(): void {
    const now = new Date();
    const day = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    // Fibonacci anniversaries only: 1, 2, 3, 5, 8, 13, 21, 34 years ago —
    // "today" isn't a memory yet, and year 4 is just year 4.
    const fibonacci = new Set([1, 2, 3, 5, 8, 13, 21, 34, 55]);

    this.photosPending.set(true);
    this.allLoaded.set(false);
    this.loadFailed.set(false);

    // Prime directive: fire each section independently and paint it the moment
    // it answers — the fast photo endpoints never wait on the slower memory
    // queries. Section flags settle as each resolves; nothing is awaited on the
    // critical path.
    let remaining = 4;
    let errors = 0;
    let photoParts = 2;
    const settle = (failed: boolean): void => {
      if (failed) {
        errors += 1;
      }
      if (--remaining === 0) {
        this.allLoaded.set(true);
        this.loadFailed.set(errors === 4);
      }
    };
    const photoSettled = (): void => {
      if (--photoParts === 0) {
        this.photosPending.set(false);
      }
    };

    void firstValueFrom(
      this.http.get<{ years: OnThisDayYear[] }>(`/api/v1/dashboard/on-this-day?day=${day}`),
    )
      .then((otd) => {
        this.onThisDay.set(otd.years.filter((g) => fibonacci.has(now.getFullYear() - g.year)));
        settle(false);
      })
      .catch(() => settle(true))
      .finally(photoSettled);

    void firstValueFrom(
      this.http.get<{ items: Array<{ id: string; mediaType: 'image' | 'video' }> }>(
        `/api/v1/dashboard/recently-added?limit=4`,
      ),
    )
      .then((recent) => {
        this.recentlyAdded.set(recent.items);
        settle(false);
      })
      .catch(() => settle(true))
      .finally(photoSettled);

    void this.memoriesApi
      .listInbox()
      .then((inbox) => {
        this.suggestions.set(inbox.suggestions.slice(0, 4));
        settle(false);
      })
      .catch(() => settle(true));

    void this.memoriesApi
      .listMemories()
      .then((memories) => {
        this.recentMemories.set(memories.memories.slice(0, 4));
        settle(false);
      })
      .catch(() => settle(true));
  }
}
