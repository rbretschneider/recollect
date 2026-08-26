import { AfterViewInit, Component, computed, ElementRef, inject, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  SearchApiService,
  SearchAssetHit,
  SearchResults,
} from '../../core/api/search-api.service';
import { TimelineAsset } from '../../core/api/api-models';
import { AppTopbar } from '../../shared/app-topbar';
import { BottomNav } from '../../shared/bottom-nav';
import { AssetViewer } from '../viewer/asset-viewer';

const DEBOUNCE_MS = 300;

/** One search box for the whole library: memories, albums, folders, files, dates. */
@Component({
  selector: 'app-search-page',
  imports: [AppTopbar, AssetViewer, BottomNav, RouterLink],
  templateUrl: './search-page.html',
  styleUrl: './search-page.scss',
})
export class SearchPage implements AfterViewInit {
  private readonly api = inject(SearchApiService);
  private readonly input = viewChild.required<ElementRef<HTMLInputElement>>('searchInput');
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private latestQuery = '';

  readonly results = signal<SearchResults | null>(null);
  readonly isSearching = signal(false);
  readonly viewerIndex = signal<number | null>(null);

  readonly hasAnyHits = computed(() => {
    const r = this.results();
    return r !== null && r.memories.length + r.albums.length + r.folders.length + r.assets.length > 0;
  });

  ngAfterViewInit(): void {
    this.input().nativeElement.focus();
  }

  onQueryInput(value: string): void {
    this.latestQuery = value;
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
    }
    if (value.trim().length < 2) {
      this.results.set(null);
      this.isSearching.set(false);
      return;
    }
    this.isSearching.set(true);
    this.debounceTimer = setTimeout(() => void this.run(value), DEBOUNCE_MS);
  }

  thumbUrl(assetId: string): string {
    return `/api/v1/assets/${assetId}/thumb/240`;
  }

  coverUrl(assetId: string | null): string | null {
    return assetId ? `/api/v1/assets/${assetId}/thumb/240` : null;
  }

  openViewer(index: number): void {
    this.viewerIndex.set(index);
  }

  closeViewer(): void {
    this.viewerIndex.set(null);
  }

  viewerAssets(): TimelineAsset[] {
    return (this.results()?.assets ?? []).map((hit: SearchAssetHit) => ({
      id: hit.id,
      mediaType: hit.mediaType,
      capturedAt: hit.capturedAt,
      capturedDay: hit.capturedAt.slice(0, 10),
      width: null,
      height: null,
      durationMs: null,
      hasThumbnail: true,
    }));
  }

  private async run(query: string): Promise<void> {
    try {
      const results = await this.api.search(query);
      if (this.latestQuery === query) {
        this.results.set(results);
      }
    } finally {
      if (this.latestQuery === query) {
        this.isSearching.set(false);
      }
    }
  }
}
