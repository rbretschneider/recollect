import { AfterViewInit, Component, computed, ElementRef, inject, signal, viewChild } from '@angular/core';
import { assetThumbUrl } from '../../core/api/photos-api.service';
import { RouterLink } from '@angular/router';
import {
  SearchApiService,
  SearchAssetHit,
  SearchResults,
} from '../../core/api/search-api.service';
import { TimelineAsset, toViewerAsset } from '../../core/api/api-models';
import { AppTopbar } from '../../shared/app-topbar';
import { AlbumPicker } from '../../shared/album-picker';
import { MemoryPick, MemoryPicker } from '../../shared/memory-picker';
import { SelectionBar } from '../../shared/selection-bar';
import { LongPressDirective } from '../../shared/long-press.directive';
import { AlbumsApiService } from '../../core/api/albums-api.service';
import { MemoriesApiService } from '../../core/api/memories-api.service';
import { AuthStateService } from '../../core/auth/auth-state.service';
import { ToastService } from '../../shared/toast.service';
import { describeError } from '../../core/describe-error';
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
  imports: [
    AlbumPicker,
    AppTopbar,
    AssetViewer,
    LongPressDirective,
    MemoryPicker,
    RouterLink,
    SelectionBar,
  ],
  templateUrl: './search-page.html',
  styleUrl: './search-page.scss',
})
export class SearchPage implements AfterViewInit {
  private readonly api = inject(SearchApiService);
  private readonly albumsApi = inject(AlbumsApiService);
  private readonly memoriesApi = inject(MemoriesApiService);
  private readonly auth = inject(AuthStateService);
  private readonly toasts = inject(ToastService);
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

  // --- Selecting hits so they can be filed ------------------------------
  //
  // Finding a photo and keeping it used to be two separate journeys: results
  // were tap-to-open and nothing else, so filing meant finding the same photo
  // again on the timeline. Press-and-hold here starts the same selection the
  // timeline uses, across both hit grids at once.

  readonly isSelecting = signal(false);
  readonly selectedIds = signal<ReadonlySet<string>>(new Set());
  readonly isPickingAlbum = signal(false);
  readonly isPickingMemory = signal(false);

  readonly selectedIdList = computed<string[]>(() => [...this.selectedIds()]);

  /** Whether the signed-in user can change shared state (write or delete grant). */
  get canWrite(): boolean {
    const permission = this.auth.user()?.permission;
    return permission === 'write' || permission === 'delete';
  }

  isSelected(assetId: string): boolean {
    return this.selectedIds().has(assetId);
  }

  /** Press-and-hold a result starts selection with it, as on the timeline. */
  onHitLongPress(assetId: string): void {
    if (!this.canWrite || this.isSelecting()) {
      return;
    }
    this.isSelecting.set(true);
    this.toggleSelected(assetId);
  }

  /** In selection mode a tap picks the photo instead of opening it. */
  onHitClick(source: 'assets' | 'semantic', index: number, assetId: string): void {
    if (this.isSelecting()) {
      this.toggleSelected(assetId);
      return;
    }
    if (source === 'semantic') {
      this.openSemanticViewer(index);
    } else {
      this.openViewer(index);
    }
  }

  cancelSelecting(): void {
    this.isSelecting.set(false);
    this.selectedIds.set(new Set());
  }

  private toggleSelected(assetId: string): void {
    this.selectedIds.update((current) => {
      const next = new Set(current);
      if (next.has(assetId)) {
        next.delete(assetId);
      } else {
        next.add(assetId);
      }
      return next;
    });
  }

  async addSelectionToAlbum(albumId: string): Promise<void> {
    const ids = this.selectedIdList();
    this.isPickingAlbum.set(false);
    this.cancelSelecting();
    if (ids.length === 0) {
      return;
    }
    try {
      await this.albumsApi.addAssets(albumId, ids);
      this.toasts.success(`Added ${ids.length === 1 ? 'a photo' : `${ids.length} photos`}.`);
    } catch (error) {
      this.toasts.error(describeError(error, 'Couldn’t add those to the album.'), {
        label: 'Retry',
        run: () => void this.albumsApi.addAssets(albumId, ids),
      });
    }
  }

  /**
   * A memory the picker just created already holds these photos — it is created
   * around them, which is what gives it its date span — so that case only needs
   * confirming, not a second write.
   */
  async addSelectionToMemory(pick: MemoryPick): Promise<void> {
    const ids = this.selectedIdList();
    this.isPickingMemory.set(false);
    this.cancelSelecting();
    if (pick.alreadyAdded) {
      this.toasts.success('Memory created.');
      return;
    }
    if (ids.length === 0) {
      return;
    }
    try {
      await this.memoriesApi.addAssets(pick.memoryId, ids);
      this.toasts.success(`Added ${ids.length === 1 ? 'a photo' : `${ids.length} photos`}.`);
    } catch (error) {
      this.toasts.error(describeError(error, 'Couldn’t add those to the memory.'), {
        label: 'Retry',
        run: () => void this.memoriesApi.addAssets(pick.memoryId, ids),
      });
    }
  }

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
    return assetThumbUrl(assetId);
  }

  coverUrl(assetId: string | null): string | null {
    return assetId ? assetThumbUrl(assetId) : null;
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
    return hits.map((hit: SearchAssetHit) => toViewerAsset(hit.id, hit.mediaType, hit.capturedAt));
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
