import {
  Component,
  computed,
  effect,
  HostListener,
  input,
  OnDestroy,
  OnInit,
  output,
  signal,
} from '@angular/core';
import { AssetDetail, TimelineAsset } from '../../core/api/api-models';
import { inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { PhotosApiService } from '../../core/api/photos-api.service';
import { TrashApiService } from '../../core/api/trash-api.service';
import { AuthStateService } from '../../core/auth/auth-state.service';
import { ConfirmService } from '../../shared/confirm.service';
import { Icon } from '../../shared/icon';

/** Minimum horizontal swipe distance (px) that counts as navigation. */
const SWIPE_THRESHOLD_PX = 60;

/** Zoom bounds and the double-tap zoom level. */
const MIN_ZOOM = 1;
const MAX_ZOOM = 6;
const DOUBLE_TAP_ZOOM = 2.5;

/** Movement beyond this (px) makes a gesture a drag, not a tap/click. */
const DRAG_THRESHOLD_PX = 8;

/**
 * Fullscreen media viewer (FRD story S4.3): swipe/arrow navigation, video
 * playback, and an info sheet. Rendered as an overlay above the current page.
 */
@Component({
  selector: 'app-asset-viewer',
  imports: [Icon, RouterLink],
  templateUrl: './asset-viewer.html',
  styleUrl: './asset-viewer.scss',
})
export class AssetViewer implements OnInit, OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthStateService);
  private readonly photosApi = inject(PhotosApiService);
  private readonly trashApi = inject(TrashApiService);
  private readonly confirms = inject(ConfirmService);

  /** The list being browsed and the index to start at. */
  readonly assets = input.required<TimelineAsset[]>();
  readonly startIndex = input.required<number>();
  /** Base URL for media routes; share pages point this at their token scope. */
  readonly mediaBase = input<string>('/api/v1/assets');
  /** Info sheet requires the authed detail endpoint; share pages disable it. */
  readonly allowInfo = input<boolean>(true);
  readonly closed = output<void>();
  /** Emitted after the current photo is moved to Trash from the viewer. */
  readonly deleted = output<string>();

  readonly index = signal(0);
  readonly showInfo = signal(false);
  readonly detail = signal<AssetDetail | null>(null);
  /** True while the server is transcoding this video for playback. */
  readonly isPreparingVideo = signal(false);
  /** Reprocess retry state for the current item. */
  readonly reprocessState = signal<'idle' | 'running' | 'done'>('idle');
  /** True until the current image's full-size file has arrived. */
  readonly isImageLoading = signal(true);
  /** True when the current image failed to render at all. */
  readonly imageFailed = signal(false);
  /** Optimistic heart states the user has toggled this session. */
  private readonly favoriteOverrides = signal<ReadonlyMap<string, boolean>>(new Map());
  /** Bumped when a prepared rendition becomes available, to reload the <video>. */
  readonly videoReloadKey = signal(0);

  readonly current = computed<TimelineAsset | null>(() => this.assets()[this.index()] ?? null);

  readonly isCurrentFavorite = computed<boolean>(() => {
    const asset = this.current();
    if (!asset) {
      return false;
    }
    return this.favoriteOverrides().get(asset.id) ?? asset.isFavorite;
  });

  /** Pinch/scroll zoom state; 1 = fitted. Pan is in screen pixels. */
  readonly zoom = signal(1);
  readonly panX = signal(0);
  readonly panY = signal(0);
  readonly isGestureActive = signal(false);

  readonly mediaTransform = computed(
    () => `translate(${this.panX()}px, ${this.panY()}px) scale(${this.zoom()})`,
  );

  private readonly activePointers = new Map<number, { x: number; y: number }>();
  private gestureStart: {
    zoom: number;
    panX: number;
    panY: number;
    x: number;
    y: number;
    pinchDistance: number | null;
  } | null = null;
  private didDrag = false;
  private didPinch = false;
  private hasHistoryEntry = false;
  private prepareTimer: ReturnType<typeof setInterval> | null = null;
  private readonly onPopState = (): void => {
    // The Android/browser back button pops our entry: close the viewer,
    // never the page underneath (the PhotoPrism-PWA failure mode).
    this.hasHistoryEntry = false;
    this.closed.emit();
  };

  constructor() {
    effect(() => {
      this.index.set(this.startIndex());
    });
    effect(() => {
      const asset = this.current();
      this.detail.set(null);
      if (asset && this.showInfo()) {
        void this.loadDetail(asset.id);
      }
    });
    effect(() => {
      this.current(); // Moving to another item resets any preparing state and the zoom.
      this.stopPreparePolling();
      this.isPreparingVideo.set(false);
      this.isImageLoading.set(true);
      this.imageFailed.set(false);
      this.resetZoom();
    });
  }

  ngOnInit(): void {
    history.pushState({ recollectViewer: true }, '', location.href);
    this.hasHistoryEntry = true;
    window.addEventListener('popstate', this.onPopState);
  }

  ngOnDestroy(): void {
    this.stopPreparePolling();
    window.removeEventListener('popstate', this.onPopState);
    // Closed by other means (X, Escape)? Consume our history entry so the
    // NEXT back press doesn't need pressing twice.
    if (this.hasHistoryEntry) {
      this.hasHistoryEntry = false;
      history.back();
    }
  }

  imageUrl(assetId: string): string {
    return `${this.mediaBase()}/${assetId}/thumb/1440`;
  }

  originalUrl(assetId: string): string {
    return `${this.mediaBase()}/${assetId}/original`;
  }

  /** Videos play through the playback route (original or H.264 rendition). */
  videoUrl(assetId: string): string {
    return `${this.mediaBase()}/${assetId}/playback?r=${this.videoReloadKey()}`;
  }

  /** The playback route answered 202 (transcoding): show status and poll. */
  onVideoError(): void {
    const asset = this.current();
    if (!asset || asset.mediaType !== 'video' || this.isPreparingVideo()) {
      return;
    }
    this.isPreparingVideo.set(true);
    this.prepareTimer = setInterval(() => void this.checkPrepared(asset.id), 3000);
  }

  private async checkPrepared(assetId: string): Promise<void> {
    try {
      const response = await fetch(`${this.mediaBase()}/${assetId}/playback`, { method: 'HEAD' });
      if (response.status === 200 && this.current()?.id === assetId) {
        this.stopPreparePolling();
        this.isPreparingVideo.set(false);
        this.videoReloadKey.update((value) => value + 1);
      }
    } catch {
      // Keep polling; transient network errors just mean "not yet".
    }
  }

  private stopPreparePolling(): void {
    if (this.prepareTimer !== null) {
      clearInterval(this.prepareTimer);
      this.prepareTimer = null;
    }
  }

  next(): void {
    if (this.index() < this.assets().length - 1) {
      this.index.update((value) => value + 1);
    }
  }

  previous(): void {
    if (this.index() > 0) {
      this.index.update((value) => value - 1);
    }
  }

  close(): void {
    this.closed.emit();
  }

  toggleInfo(): void {
    this.showInfo.update((value) => !value);
    const asset = this.current();
    if (this.showInfo() && asset) {
      void this.loadDetail(asset.id);
    }
  }

  // --- Gestures: pinch/wheel zoom, pan while zoomed, swipe-nav at 1x -------

  onPointerDown(event: PointerEvent): void {
    if ((event.target as HTMLElement).tagName === 'VIDEO') {
      return; // Leave video controls alone.
    }
    this.activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    this.isGestureActive.set(true);
    this.didDrag = false;
    if (this.activePointers.size === 2) {
      this.didPinch = true;
      this.beginGesture(this.pinchDistance());
    } else {
      this.didPinch = false;
      this.beginGesture(null);
    }
  }

  onPointerMove(event: PointerEvent): void {
    if (!this.activePointers.has(event.pointerId) || !this.gestureStart) {
      return;
    }
    this.activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const start = this.gestureStart;
    const center = this.pointerCenter();
    if (Math.hypot(center.x - start.x, center.y - start.y) > DRAG_THRESHOLD_PX) {
      this.didDrag = true;
    }
    if (this.activePointers.size === 2 && start.pinchDistance !== null) {
      const scale = this.clampZoom((start.zoom * this.pinchDistance()) / start.pinchDistance);
      this.zoomAround(center, scale, start);
    } else if (this.activePointers.size === 1 && this.zoom() > MIN_ZOOM) {
      this.panX.set(start.panX + (center.x - start.x));
      this.panY.set(start.panY + (center.y - start.y));
    }
  }

  onPointerUp(event: PointerEvent): void {
    const wasSingle = this.activePointers.size === 1;
    const start = this.gestureStart;
    this.activePointers.delete(event.pointerId);
    if (this.activePointers.size > 0) {
      this.beginGesture(this.activePointers.size === 2 ? this.pinchDistance() : null);
      return;
    }
    this.isGestureActive.set(false);
    if (this.zoom() < 1.05) {
      this.resetZoom();
    }
    if (wasSingle && !this.didPinch && this.zoom() === MIN_ZOOM && start) {
      const deltaX = event.clientX - start.x;
      if (deltaX < -SWIPE_THRESHOLD_PX) {
        this.next();
      } else if (deltaX > SWIPE_THRESHOLD_PX) {
        this.previous();
      }
    }
    this.gestureStart = null;
  }

  /** Desktop: scroll wheel zooms toward the cursor. */
  onWheel(event: WheelEvent): void {
    event.preventDefault();
    const scale = this.clampZoom(this.zoom() * Math.exp(-event.deltaY * 0.0022));
    this.zoomAround({ x: event.clientX, y: event.clientY }, scale, {
      zoom: this.zoom(),
      panX: this.panX(),
      panY: this.panY(),
    });
    if (this.zoom() < 1.05) {
      this.resetZoom();
    }
  }

  /** Double tap / double click toggles between fitted and zoomed-in. */
  onDoubleClick(event: MouseEvent): void {
    if ((event.target as HTMLElement).tagName === 'VIDEO') {
      return;
    }
    if (this.zoom() > MIN_ZOOM) {
      this.resetZoom();
    } else {
      this.zoomAround({ x: event.clientX, y: event.clientY }, DOUBLE_TAP_ZOOM, {
        zoom: 1,
        panX: 0,
        panY: 0,
      });
    }
  }

  /** Anywhere that isn't the media or a control closes the viewer. */
  onStageClick(event: MouseEvent): void {
    if (this.didDrag || this.didPinch) {
      return; // The tail end of a pan/pinch is not a click.
    }
    if (event.target === event.currentTarget) {
      if (this.showInfo()) {
        this.showInfo.set(false);
      } else {
        this.close();
      }
    }
  }

  private beginGesture(pinchDistance: number | null): void {
    const center = this.pointerCenter();
    this.gestureStart = {
      zoom: this.zoom(),
      panX: this.panX(),
      panY: this.panY(),
      x: center.x,
      y: center.y,
      pinchDistance,
    };
  }

  /** Rescales so the image point under `anchor` stays under it. */
  private zoomAround(
    anchor: { x: number; y: number },
    scale: number,
    from: { zoom: number; panX: number; panY: number },
  ): void {
    const originX = window.innerWidth / 2;
    const originY = window.innerHeight / 2;
    const imagePointX = (anchor.x - originX - from.panX) / from.zoom;
    const imagePointY = (anchor.y - originY - from.panY) / from.zoom;
    this.zoom.set(scale);
    this.panX.set(anchor.x - originX - imagePointX * scale);
    this.panY.set(anchor.y - originY - imagePointY * scale);
  }

  private pointerCenter(): { x: number; y: number } {
    const points = [...this.activePointers.values()];
    if (points.length === 0) {
      return { x: 0, y: 0 };
    }
    return {
      x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
      y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
    };
  }

  private pinchDistance(): number {
    const [first, second] = [...this.activePointers.values()];
    return Math.hypot(second.x - first.x, second.y - first.y);
  }

  private clampZoom(value: number): number {
    return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM * 0.85, value));
  }

  private resetZoom(): void {
    this.zoom.set(1);
    this.panX.set(0);
    this.panY.set(0);
  }

  @HostListener('document:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.close();
    } else if (event.key === 'ArrowRight') {
      this.next();
    } else if (event.key === 'ArrowLeft') {
      this.previous();
    }
  }

  get canWrite(): boolean {
    const permission = this.auth.user()?.permission;
    return permission === 'write' || permission === 'delete';
  }

  /** Hearts are personal, so any signed-in member gets one (not on share pages). */
  get canFavorite(): boolean {
    return this.allowInfo() && this.auth.user() !== null;
  }

  get canDelete(): boolean {
    return this.allowInfo() && this.auth.user()?.permission === 'delete';
  }

  async toggleFavorite(): Promise<void> {
    const asset = this.current();
    if (!asset) {
      return;
    }
    const next = !this.isCurrentFavorite();
    this.favoriteOverrides.update((map) => new Map(map).set(asset.id, next));
    try {
      await this.photosApi.setFavorite(asset.id, next);
    } catch {
      this.favoriteOverrides.update((map) => new Map(map).set(asset.id, !next));
    }
  }

  /** Saves the original with its friendly server-assigned name. */
  downloadCurrent(): void {
    const asset = this.current();
    if (!asset) {
      return;
    }
    const anchor = document.createElement('a');
    anchor.href = `/api/v1/assets/${asset.id}/download`;
    anchor.download = '';
    anchor.click();
  }

  /** Moves the current photo to Trash (confirmed), then shows the next one. */
  async deleteCurrent(): Promise<void> {
    const asset = this.current();
    if (!asset) {
      return;
    }
    const confirmed = await this.confirms.ask({
      title: 'Move this photo to Trash?',
      message:
        'It leaves your library now and is permanently deleted after the holding period. You can restore it from Trash until then.',
      confirmLabel: 'Move to Trash',
    });
    if (!confirmed) {
      return;
    }
    await this.trashApi.trashAssets([asset.id]);
    // The parent removes it from the list; step off the doomed index first.
    if (this.assets().length <= 1) {
      this.close();
    } else if (this.index() >= this.assets().length - 1) {
      this.previous();
    }
    this.deleted.emit(asset.id);
  }

  /** Human summary of what failed for this item, or empty when healthy. */
  processingProblem(info: AssetDetail): string {
    if (info.stageErrors) {
      return Object.entries(info.stageErrors)
        .map(([stage, message]) => `${stage}: ${message}`)
        .join('; ');
    }
    if (!info.hasThumbnail) {
      return 'Thumbnail was never generated.';
    }
    return '';
  }

  /** Queues a re-run of processing for this item and polls until it lands. */
  async reprocess(): Promise<void> {
    const asset = this.current();
    if (!asset || this.reprocessState() === 'running') {
      return;
    }
    this.reprocessState.set('running');
    await firstValueFrom(this.http.post(`/api/v1/assets/${asset.id}/reprocess`, {}));
    const startedAt = Date.now();
    const poll = setInterval(() => {
      void (async () => {
        if (this.current()?.id !== asset.id || Date.now() - startedAt > 60_000) {
          clearInterval(poll);
          this.reprocessState.set('idle');
          return;
        }
        await this.loadDetail(asset.id);
        const info = this.detail();
        if (info && info.hasThumbnail && !info.stageErrors) {
          clearInterval(poll);
          this.reprocessState.set('done');
        }
      })();
    }, 3000);
  }

  formatDate(iso: string): string {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: 'short' }).format(
      new Date(iso),
    );
  }

  formatSize(bytes: number | null): string {
    if (bytes === null) {
      return '';
    }
    if (bytes < 1024 * 1024) {
      return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    }
    const megabytes = bytes / (1024 * 1024);
    return `${megabytes.toFixed(1)} MB`;
  }

  /** A file this small is almost never a real photo — likely a cloud-only stub. */
  isSuspiciouslySmall(info: AssetDetail): boolean {
    return info.mediaType === 'image' && info.sizeBytes !== null && info.sizeBytes < 16 * 1024;
  }

  googleMapsUrl(info: AssetDetail): string {
    return `https://www.google.com/maps?q=${info.gpsLat},${info.gpsLon}`;
  }

  /** The folder holding this file, for linking into the folders view. */
  folderOf(info: AssetDetail): string {
    return (info.relPath ?? '').split('/').slice(0, -1).join('/');
  }

  private async loadDetail(assetId: string): Promise<void> {
    try {
      const detail = await firstValueFrom(
        this.http.get<AssetDetail>(`/api/v1/assets/${assetId}/detail`),
      );
      if (this.current()?.id === assetId) {
        this.detail.set(detail);
      }
    } catch {
      // The info sheet simply stays empty when detail cannot load.
    }
  }
}
