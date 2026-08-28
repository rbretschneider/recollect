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
import { formatDuration } from '../../core/format-duration';
import { AlbumPicker } from '../../shared/album-picker';
import { ActivitySpinner } from '../../shared/activity-spinner';
import { AccountBadge } from '../../shared/account-badge';
import { Brand } from '../../shared/brand';
import { ConfirmService } from '../../shared/confirm.service';
import { Icon } from '../../shared/icon';
import { LongPressDirective } from '../../shared/long-press.directive';
import { AssetViewer } from '../viewer/asset-viewer';
import { RouterLink } from '@angular/router';

/** One day's worth of photos in the grid. */
interface DayGroup {
  day: string;
  label: string;
  items: TimelineAsset[];
}

/**
 * The grid presentations: PhotoPrism-style cards with metadata underneath,
 * the justified mosaic, and a larger-tile mosaic.
 */
export type GridViewMode = 'cards' | 'mosaic' | 'large';

const VIEW_MODE_KEY = 'rc-grid-view';

function loadViewMode(): GridViewMode {
  try {
    const stored = localStorage.getItem(VIEW_MODE_KEY);
    return stored === 'cards' || stored === 'large' ? stored : 'mosaic';
  } catch {
    return 'mosaic';
  }
}

const PAGE_SIZE = 100;
const STATUS_POLL_MS = 4000;

/** The main photo timeline: grid grouped by day with infinite scroll. */
@Component({
  selector: 'app-photos-page',
  imports: [
    ActivitySpinner,
    AlbumPicker,
    AssetViewer,

    AccountBadge,
    Brand,
    Icon,
    LongPressDirective,
    RouterLink,
  ],
  templateUrl: './photos-page.html',
  styleUrl: './photos-page.scss',
})
export class PhotosPage implements AfterViewInit, OnDestroy {
  private readonly photosApi = inject(PhotosApiService);
  private readonly libraryApi = inject(LibraryApiService);
  private readonly trashApi = inject(TrashApiService);
  private readonly albumsApi = inject(AlbumsApiService);
  private readonly auth = inject(AuthStateService);
  private readonly confirms = inject(ConfirmService);
  private readonly destroyRef = inject(DestroyRef);
  private undoTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly sentinel = viewChild.required<ElementRef<HTMLElement>>('sentinel');
  private observer: IntersectionObserver | null = null;
  private statusTimer: ReturnType<typeof setInterval> | null = null;
  private nextCursor: string | null = null;
  private hasLoadedFirstPage = false;

  readonly items = signal<TimelineAsset[]>([]);
  readonly viewerIndex = signal<number | null>(null);
  /** Grid presentation: justified mosaic (default), uniform grid, or small squares. */
  readonly viewMode = signal<GridViewMode>(loadViewMode());
  readonly isSelecting = signal(false);
  /** Show only the signed-in user's hearted photos. */
  readonly favoritesOnly = signal(false);
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
    // Wide cards deserve the sharper tier; dense grids stay light.
    return this.photosApi.thumbnailUrl(asset.id, this.viewMode() === 'cards' ? 720 : 240);
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

  /** PhotoPrism-PWA gesture: press-and-hold a tile starts selection with it. */
  onTileLongPress(asset: TimelineAsset): void {
    if (!this.canWrite || this.isSelecting()) {
      return;
    }
    this.isSelecting.set(true);
    this.toggleSelected(asset.id);
  }

  startSelecting(): void {
    this.isSelecting.set(true);
  }

  durationLabel(asset: TimelineAsset): string {
    return asset.durationMs === null ? '' : formatDuration(asset.durationMs);
  }

  // --- Card view metadata (PhotoPrism-style details) ----------------------

  /** Card title, PhotoPrism-style: place + year when known, else folder + year. */
  cardTitle(asset: TimelineAsset): string {
    const year = asset.capturedDay.slice(0, 4);
    const town = asset.place?.split(',')[0]?.trim();
    if (town) {
      return `${town} / ${year}`;
    }
    const folderName = asset.folder?.split('/').at(-1);
    return folderName ? `${folderName} / ${year}` : year;
  }

  cardDate(asset: TimelineAsset): string {
    return new Intl.DateTimeFormat(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(asset.capturedAt));
  }

  /** "Google Pixel 7 Pro, ISO 336, 1/120". */
  cardCamera(asset: TimelineAsset): string {
    const camera = [asset.cameraMake, asset.cameraModel].filter(Boolean).join(' ');
    const parts = [camera];
    if (asset.iso != null) {
      parts.push(`ISO ${asset.iso}`);
    }
    if (asset.exposureTime) {
      parts.push(asset.exposureTime);
    }
    return parts.filter(Boolean).join(', ');
  }

  /** "Pixel 7 Pro 6.81mm ƒ/1.85, 24mm". */
  cardLens(asset: TimelineAsset): string {
    const parts: string[] = [];
    if (asset.lensModel) {
      parts.push(asset.lensModel);
    }
    if (asset.fNumber != null) {
      parts.push(`ƒ/${asset.fNumber}`);
    }
    if (asset.focalLength35 != null) {
      parts.push(`${asset.focalLength35}mm`);
    }
    return parts.join(parts.length > 1 && asset.lensModel ? ' ' : ', ');
  }

  /** "JPEG, 2268 × 4032, 1.7 MB" (or duration for videos). */
  cardFormat(asset: TimelineAsset): string {
    const parts: string[] = [];
    const format = asset.mime?.split('/')[1]?.toUpperCase();
    if (format) {
      parts.push(format);
    }
    if (asset.mediaType === 'video' && asset.durationMs !== null) {
      parts.push(this.durationLabel(asset));
    } else if (asset.width && asset.height) {
      parts.push(`${asset.width} × ${asset.height}`);
    }
    if (asset.sizeBytes != null) {
      parts.push(
        asset.sizeBytes < 1024 * 1024
          ? `${Math.max(1, Math.round(asset.sizeBytes / 1024))} KB`
          : `${(asset.sizeBytes / (1024 * 1024)).toFixed(1)} MB`,
      );
    }
    return parts.join(', ');
  }

  toggleFavoritesOnly(): void {
    this.favoritesOnly.update((value) => !value);
    void this.refreshFromStart();
  }

  /** The viewer trashed a photo: drop it from the grid and offer Undo. */
  onViewerDeleted(assetId: string): void {
    this.items.update((list) => list.filter((item) => item.id !== assetId));
    this.showUndo([assetId]);
  }

  /** In selection mode, tapping a day header selects (or clears) that whole day. */
  toggleDaySelection(group: DayGroup): void {
    if (!this.isSelecting()) {
      return;
    }
    this.selectedIds.update((current) => {
      const next = new Set(current);
      const allSelected = group.items.every((item) => next.has(item.id));
      for (const item of group.items) {
        if (allSelected) {
          next.delete(item.id);
        } else {
          next.add(item.id);
        }
      }
      return next;
    });
  }

  isDayFullySelected(group: DayGroup): boolean {
    return group.items.every((item) => this.selectedIds().has(item.id));
  }

  setViewMode(mode: GridViewMode): void {
    this.viewMode.set(mode);
    try {
      localStorage.setItem(VIEW_MODE_KEY, mode);
    } catch {
      // Per-viewer convenience only; losing it is harmless.
    }
  }

  /** Aspect ratio driving the justified mosaic; unknown dimensions render square. */
  aspectOf(asset: TimelineAsset): number {
    if (!asset.width || !asset.height) {
      return 1;
    }
    // Clamp so panoramas don't take a whole row and portraits stay readable.
    return Math.min(2.4, Math.max(0.55, asset.width / asset.height));
  }

  get userInitial(): string {
    return this.userName().charAt(0).toUpperCase();
  }

  get isAdmin(): boolean {
    return this.auth.user()?.isAdmin ?? false;
  }

  cancelSelecting(): void {
    this.isSelecting.set(false);
    this.selectedIds.set(new Set());
  }

  isSelected(assetId: string): boolean {
    return this.selectedIds().has(assetId);
  }

  /** Trashes the selection (after confirming) and offers a timed Undo (S5.1). */
  async deleteSelected(): Promise<void> {
    const ids = [...this.selectedIds()];
    if (ids.length === 0) {
      return;
    }
    const confirmed = await this.confirms.ask({
      title: `Move ${ids.length === 1 ? 'this photo' : `${ids.length} photos`} to Trash?`,
      message:
        'They leave your library now and are permanently deleted after the holding period. You can restore them from Trash until then.',
      confirmLabel: 'Move to Trash',
    });
    if (!confirmed) {
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
      const page = await this.photosApi.getTimelinePage(
        this.nextCursor,
        PAGE_SIZE,
        this.favoritesOnly(),
      );
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
    // An empty favorites filter means "no hearts yet", not "no library".
    return (
      !this.favoritesOnly() &&
      this.hasLoadedFirstPage &&
      this.items().length === 0 &&
      this.pendingCount() === 0
    );
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
