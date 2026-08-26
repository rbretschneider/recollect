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
import { TrashApiService } from '../../core/api/trash-api.service';
import { AlbumsApiService } from '../../core/api/albums-api.service';
import { AlbumPicker } from '../../shared/album-picker';
import { BottomNav } from '../../shared/bottom-nav';
import { AssetViewer } from '../viewer/asset-viewer';
import { RouterLink } from '@angular/router';

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
  imports: [AlbumPicker, AssetViewer, BottomNav, RouterLink],
  templateUrl: './photos-page.html',
  styleUrl: './photos-page.scss',
})
export class PhotosPage implements AfterViewInit, OnDestroy {
  private readonly photosApi = inject(PhotosApiService);
  private readonly libraryApi = inject(LibraryApiService);
  private readonly trashApi = inject(TrashApiService);
  private readonly albumsApi = inject(AlbumsApiService);
  private readonly auth = inject(AuthStateService);
  private readonly destroyRef = inject(DestroyRef);
  private undoTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly sentinel = viewChild.required<ElementRef<HTMLElement>>('sentinel');
  private observer: IntersectionObserver | null = null;
  private statusTimer: ReturnType<typeof setInterval> | null = null;
  private nextCursor: string | null = null;
  private hasLoadedFirstPage = false;

  readonly items = signal<TimelineAsset[]>([]);
  readonly viewerIndex = signal<number | null>(null);
  readonly isSelecting = signal(false);
  readonly selectedIds = signal<ReadonlySet<string>>(new Set());
  readonly isPickingAlbum = signal(false);
  readonly undoIds = signal<string[]>([]);
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

  openViewer(asset: TimelineAsset): void {
    const index = this.items().findIndex((item) => item.id === asset.id);
    if (index >= 0) {
      this.viewerIndex.set(index);
    }
  }

  closeViewer(): void {
    this.viewerIndex.set(null);
  }

  /** Whether the signed-in user holds the delete grant. */
  get canDelete(): boolean {
    return this.auth.user()?.permission === 'delete';
  }

  /** Whether the signed-in user can change shared state (write or delete grant). */
  get canWrite(): boolean {
    const permission = this.auth.user()?.permission;
    return permission === 'write' || permission === 'delete';
  }

  startAlbumPick(): void {
    this.isPickingAlbum.set(true);
  }

  cancelAlbumPick(): void {
    this.isPickingAlbum.set(false);
  }

  async addSelectionToAlbum(albumId: string): Promise<void> {
    const ids = [...this.selectedIds()];
    this.isPickingAlbum.set(false);
    this.cancelSelecting();
    if (ids.length > 0) {
      await this.albumsApi.addAssets(albumId, ids);
    }
  }

  onTileClick(asset: TimelineAsset): void {
    if (this.isSelecting()) {
      this.toggleSelected(asset.id);
    } else {
      this.openViewer(asset);
    }
  }

  startSelecting(): void {
    this.isSelecting.set(true);
  }

  cancelSelecting(): void {
    this.isSelecting.set(false);
    this.selectedIds.set(new Set());
  }

  isSelected(assetId: string): boolean {
    return this.selectedIds().has(assetId);
  }

  /** Trashes the selection optimistically and offers a timed Undo (S5.1). */
  async deleteSelected(): Promise<void> {
    const ids = [...this.selectedIds()];
    if (ids.length === 0) {
      return;
    }
    this.cancelSelecting();
    this.items.update((list) => list.filter((item) => !ids.includes(item.id)));
    await this.trashApi.trashAssets(ids);
    this.showUndo(ids);
  }

  async undoDelete(): Promise<void> {
    const ids = this.undoIds();
    this.dismissUndo();
    if (ids.length > 0) {
      await this.trashApi.restoreAssets(ids);
      await this.refreshFromStart();
    }
  }

  dismissUndo(): void {
    if (this.undoTimer !== null) {
      clearTimeout(this.undoTimer);
      this.undoTimer = null;
    }
    this.undoIds.set([]);
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

  private showUndo(ids: string[]): void {
    this.undoIds.set(ids);
    this.undoTimer = setTimeout(() => this.dismissUndo(), 6000);
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
