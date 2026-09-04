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
import { SlideshowOverlay, SlideItem, SlideshowCollection } from './slideshow-overlay';

interface OnThisDayMoment {
  key: string;
  kind: 'memory' | 'place' | 'person';
  year: number;
  title: string;
  subtitle: string | null;
  memoryId: string | null;
  personId: string | null;
  coverAssetId: string;
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

  readonly onThisDay = signal<OnThisDayMoment[]>([]);
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

  /** The moment's stack was tapped: play it as a slideshow. */
  readonly slideshowItems = signal<SlideItem[] | null>(null);
  readonly slideshowTitle = signal('');

  /** The moment on screen, so the slideshow can offer to share it. */
  readonly slideshowCollection = signal<SlideshowCollection | null>(null);

  openSlideshow(moment: OnThisDayMoment): void {
    this.slideshowTitle.set(`${moment.title} · ${this.yearsAgo(moment.year)}`);
    this.slideshowItems.set(moment.items);
    this.slideshowCollection.set({
      title: `${moment.title}, ${moment.year}`,
      kind: moment.kind,
      memoryId: moment.memoryId,
      assetIds: moment.items.map((item) => item.id),
    });
  }

  closeSlideshow(): void {
    this.slideshowItems.set(null);
  }

  /** Up to four fanned photos per stack; the rest wait for the show. */
  stackPreview(moment: OnThisDayMoment): Array<{ id: string; mediaType: string }> {
    return moment.items.slice(0, 4);
  }

  /** The secondary line under a moment: year, count, and place/people. */
  momentMeta(moment: OnThisDayMoment): string {
    const count = `${moment.items.length} ${moment.items.length === 1 ? 'photo' : 'photos'}`;
    const parts = [String(moment.year), count];
    if (moment.subtitle) {
      parts.push(moment.subtitle);
    }
    return parts.join(' · ');
  }

  /** Which moment's save-as-album is in flight (per-stack busy state). */
  readonly savingAlbumKey = signal<string | null>(null);

  /** One tap turns a moment's pile into a real album and opens it. */
  async saveAsAlbum(moment: OnThisDayMoment): Promise<void> {
    if (this.savingAlbumKey() !== null) {
      return;
    }
    this.savingAlbumKey.set(moment.key);
    try {
      const { albumId } = await this.albumsApi.create(
        `${moment.title}, ${moment.year}`,
        moment.items.map((item) => item.id),
      );
      await this.router.navigate(['/albums', albumId]);
    } catch {
      this.toasts.error('Couldn’t create that album.', {
        label: 'Retry',
        run: () => void this.saveAsAlbum(moment),
      });
    } finally {
      this.savingAlbumKey.set(null);
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
      this.http.get<{ moments: OnThisDayMoment[] }>(
        `/api/v1/dashboard/on-this-day?day=${day}&year=${now.getFullYear()}`,
      ),
    )
      .then((otd) => {
        this.onThisDay.set(otd.moments);
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
