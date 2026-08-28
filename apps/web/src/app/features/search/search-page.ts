import { AfterViewInit, Component, computed, ElementRef, inject, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  SearchApiService,
  SearchAssetHit,
  SearchResults,
} from '../../core/api/search-api.service';
import { TimelineAsset } from '../../core/api/api-models';
import { AppTopbar } from '../../shared/app-topbar';
import { AssetViewer } from '../viewer/asset-viewer';

const DEBOUNCE_MS = 300;
const RECENT_SEARCHES_KEY = 'rc-recent-searches';
const RECENT_SEARCHES_MAX = 5;

/** Starter queries for the empty state, showing the kinds of things search understands. */
const EXAMPLE_QUERIES = ['july 2025', 'christmas', 'beach', 'birthday'];

function loadRecentSearches(): string[] {
  try {
    const stored = JSON.parse(localStorage.getItem(RECENT_SEARCHES_KEY) ?? '[]') as unknown;
    return Array.isArray(stored) ? stored.filter((q): q is string => typeof q === 'string') : [];
  } catch {
    return [];
  }
}

/** One search box for the whole library: memories, albums, folders, files, dates. */
@Component({
  selector: 'app-search-page',
  imports: [AppTopbar, AssetViewer, RouterLink],
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
  readonly recentSearches = signal<string[]>(loadRecentSearches());
  readonly exampleQueries = EXAMPLE_QUERIES;
  readonly viewerIndex = signal<number | null>(null);
  /** Which hit list feeds the viewer (filename hits vs semantic hits). */
  readonly viewerSource = signal<'assets' | 'semantic'>('assets');

  readonly hasAnyHits = computed(() => {
    const r = this.results();
    return (
      r !== null &&
      r.memories.length +
        r.albums.length +
        r.folders.length +
        r.people.length +
        r.assets.length +
        r.semantic.length >
        0
    );
  });

  faceCropUrl(faceId: string): string {
    return `/api/v1/people/faces/${faceId}/crop`;
  }

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

  /** A zero-state chip fills the box and searches immediately. */
  applySuggestion(query: string): void {
    this.input().nativeElement.value = query;
    this.input().nativeElement.focus();
    this.onQueryInput(query);
  }

  /** Remembers a query that actually found something (per-device convenience). */
  private rememberSearch(query: string): void {
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      return;
    }
    const next = [trimmed, ...this.recentSearches().filter((q) => q !== trimmed)].slice(
      0,
      RECENT_SEARCHES_MAX,
    );
    this.recentSearches.set(next);
    try {
      localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next));
    } catch {
      // Convenience only; losing it is harmless.
    }
  }

  thumbUrl(assetId: string): string {
    return `/api/v1/assets/${assetId}/thumb/240`;
  }

  coverUrl(assetId: string | null): string | null {
    return assetId ? `/api/v1/assets/${assetId}/thumb/240` : null;
  }

  openViewer(index: number): void {
    this.viewerSource.set('assets');
    this.viewerIndex.set(index);
  }

  openSemanticViewer(index: number): void {
    this.viewerSource.set('semantic');
    this.viewerIndex.set(index);
  }

  closeViewer(): void {
    this.viewerIndex.set(null);
  }

  /** computed: the viewer needs a stable array reference (see person page). */
  readonly viewerAssets = computed<TimelineAsset[]>(() => {
    const r = this.results();
    const hits = this.viewerSource() === 'semantic' ? (r?.semantic ?? []) : (r?.assets ?? []);
    return hits.map((hit: SearchAssetHit) => ({
      id: hit.id,
      mediaType: hit.mediaType,
      capturedAt: hit.capturedAt,
      capturedDay: hit.capturedAt.slice(0, 10),
      width: null,
      height: null,
      durationMs: null,
      hasThumbnail: true,
      isFavorite: false,
    }));
  });

  private async run(query: string): Promise<void> {
    try {
      const results = await this.api.search(query);
      if (this.latestQuery === query) {
        this.results.set(results);
        if (this.hasAnyHits()) {
          this.rememberSearch(query);
        }
      }
    } finally {
      if (this.latestQuery === query) {
        this.isSearching.set(false);
      }
    }
  }
}
