import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { assetThumbUrl } from '../../core/api/photos-api.service';
import { HttpClient } from '@angular/common/http';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AlbumsApiService } from '../../core/api/albums-api.service';
import { MemoriesApiService } from '../../core/api/memories-api.service';
import { InboxSuggestion, MemorySummary, TimelineAsset } from '../../core/api/api-models';
import { AuthStateService } from '../../core/auth/auth-state.service';
import { AppTopbar } from '../../shared/app-topbar';
import { PageLoading } from '../../shared/page-loading';
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
  imports: [AppTopbar, AssetViewer, PageLoading, RouterLink, SlideshowOverlay, Icon],
  templateUrl: './dashboard-page.html',
  styleUrl: './dashboard-page.scss',
})
export class DashboardPage implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly memoriesApi = inject(MemoriesApiService);
  private readonly albumsApi = inject(AlbumsApiService);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthStateService);

  readonly onThisDay = signal<OnThisDayYear[]>([]);
  readonly suggestions = signal<InboxSuggestion[]>([]);
  readonly recentMemories = signal<MemorySummary[]>([]);
  readonly isLoaded = signal(false);

  /** Viewer over one year's strip. */
  readonly viewerAssets = signal<TimelineAsset[]>([]);
  readonly viewerIndex = signal<number | null>(null);

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

  private async load(): Promise<void> {
    const now = new Date();
    const day = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const [otd, inbox, memories] = await Promise.all([
      firstValueFrom(
        this.http.get<{ years: OnThisDayYear[] }>(`/api/v1/dashboard/on-this-day?day=${day}`),
      ).catch(() => ({ years: [] })),
      this.memoriesApi.listInbox().catch(() => ({ suggestions: [] })),
      this.memoriesApi.listMemories().catch(() => ({ memories: [] })),
    ]);
    // Fibonacci anniversaries only: 1, 2, 3, 5, 8, 13, 21, 34 years ago —
    // "today" isn't a memory yet, and year 4 is just year 4.
    const fibonacci = new Set([1, 2, 3, 5, 8, 13, 21, 34, 55]);
    this.onThisDay.set(
      otd.years.filter((group) => fibonacci.has(now.getFullYear() - group.year)),
    );
    this.suggestions.set(inbox.suggestions.slice(0, 4));
    this.recentMemories.set(memories.memories.slice(0, 4));
    this.isLoaded.set(true);
  }
}
