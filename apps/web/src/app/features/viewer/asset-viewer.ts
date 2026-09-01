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
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ShareButton } from '../../shared/share-button';
import { PhotosApiService } from '../../core/api/photos-api.service';
import { TrashApiService } from '../../core/api/trash-api.service';
import { AuthStateService } from '../../core/auth/auth-state.service';
import { ConfirmService } from '../../shared/confirm.service';
import { ToastService } from '../../shared/toast.service';
import { Icon } from '../../shared/icon';

/** Minimum horizontal swipe distance (px) that counts as navigation. */
const SWIPE_THRESHOLD_PX = 60;

/** Zoom bounds and the double-tap zoom level. */
const MIN_ZOOM = 1;
const MAX_ZOOM = 6;
const DOUBLE_TAP_ZOOM = 2.5;

/** Movement beyond this (px) makes a gesture a drag, not a tap/click. */
const DRAG_THRESHOLD_PX = 8;

/** Bottom band of the stage reserved for the native video seek bar. */
const VIDEO_CONTROLS_STRIP_PX = 72;

/**
 * Fullscreen media viewer (FRD story S4.3): swipe/arrow navigation, video
 * playback, and an info sheet. Rendered as an overlay above the current page.
 */
@Component({
  selector: 'app-asset-viewer',
  imports: [Icon, RouterLink, ShareButton, FormsModule],
  templateUrl: './asset-viewer.html',
  styleUrl: './asset-viewer.scss',
})
export class AssetViewer implements OnInit, OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthStateService);
  private readonly photosApi = inject(PhotosApiService);
  private readonly trashApi = inject(TrashApiService);
  private readonly confirms = inject(ConfirmService);
  private readonly toasts = inject(ToastService);

  /** The list being browsed and the index to start at. */
  readonly assets = input.required<TimelineAsset[]>();
  readonly startIndex = input.required<number>();
  /** Base URL for media routes; share pages point this at their token scope. */
  readonly mediaBase = input<string>('/api/v1/assets');
  /** Info sheet requires the authed detail endpoint; share pages disable it. */
  readonly allowInfo = input<boolean>(true);
  /** Optional per-asset captions (memory scrapbook). Shown over the photo. */
  readonly captions = input<Record<string, string>>({});
  readonly closed = output<void>();
  /** Emitted after the current photo is moved to Trash from the viewer. */
  readonly deleted = output<string>();

  readonly index = signal(0);
  readonly showInfo = signal(false);
  readonly detail = signal<AssetDetail | null>(null);
  /** True while the info panel's metadata is being fetched (show a spinner). */
  readonly detailLoading = signal(false);
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
  /** Which way the last navigation went, for the entry glide direction. */
  readonly navDirection = signal<'forward' | 'backward'>('forward');
  /** 360° photosphere overlay open? (Only offered when detail says so.) */
  readonly showSphere = signal(false);
  private sphereViewer: { destroy: () => void } | null = null;
  /** The outgoing image, briefly kept as a fading ghost under the new one. */
  readonly ghostUrl = signal<string | null>(null);
  private ghostTimer: ReturnType<typeof setTimeout> | null = null;

  /** The current asset as a one-item list so @for track recreates the media
   *  element per photo — that's what makes the entry animation run. */
  readonly currentAsList = computed<TimelineAsset[]>(() => {
    const asset = this.current();
    return asset ? [asset] : [];
  });
  /** Bumped when a prepared rendition becomes available, to reload the <video>. */
  readonly videoReloadKey = signal(0);

  readonly current = computed<TimelineAsset | null>(() => this.assets()[this.index()] ?? null);

  /**
   * The current video is known-unplayable (incomplete/corrupt on disk — no
   * valid index). Show that plainly instead of an endless "Preparing…" spinner:
   * transcoding can never make a damaged file playable.
   */
  readonly videoDamaged = computed<boolean>(() => {
    const asset = this.current();
    return asset?.mediaType === 'video' && this.detail()?.stageErrors?.['playback'] != null;
  });

  /** The caption for the photo on screen, if the memory gave it one. */
  readonly currentCaption = computed<string>(() => {
    const asset = this.current();
    return asset ? (this.captions()[asset.id] ?? '') : '';
  });

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
  private lastResetAssetId: string | null = null;
  private lastShownWasImage = false;
  /** Swipe-over-video tracking; native controls stay untouched. */
  private videoSwipeStart: { x: number; y: number } | null = null;
  private hasHistoryEntry = false;
  private prepareTimer: ReturnType<typeof setInterval> | null = null;
  /** The gallery's scroll depth when the viewer opened; restored on close. */
  private savedScrollY = 0;
  private readonly onPopState = (): void => {
    // The Android/browser back button pops our entry: close the viewer,
    // never the page underneath (the PhotoPrism-PWA failure mode).
    this.hasHistoryEntry = false;
    this.closed.emit();
    this.restoreScroll();
  };

  /**
   * Closing must land you exactly where you were in the gallery. The router
   * reacts to our popped history entry by "restoring" a scroll position it
   * never recorded (the top), so we re-assert the real one — twice, to win
   * the race against its async scroller.
   */
  private restoreScroll(): void {
    const y = this.savedScrollY;
    requestAnimationFrame(() => window.scrollTo(0, y));
    setTimeout(() => window.scrollTo(0, y), 80);
  }

  constructor() {
    effect(() => {
      this.index.set(this.startIndex());
    });
    effect(() => {
      // Once detail confirms a video is damaged, drop any "Preparing…" state —
      // there is nothing to wait for.
      if (this.videoDamaged()) {
        this.isPreparingVideo.set(false);
        this.stopPreparePolling();
      }
    });
    effect(() => {
      // Detail loads for every shown asset (small JSON): it powers the info
      // sheet AND surfaces special types like 360° photospheres up front.
      const asset = this.current();
      this.detail.set(null);
      this.showSphere.set(false);
      if (asset && this.allowInfo()) {
        void this.loadDetail(asset.id);
      }
    });
    effect(() => {
      // Reset only when the SHOWN PHOTO changes — hosts may rebuild the
      // assets array each tick, and resetting then leaves an eternal spinner.
      const assetId = this.current()?.id ?? null;
      if (assetId === this.lastResetAssetId) {
        return;
      }
      // The photo we're leaving lingers as a fading ghost (images only).
      if (this.lastResetAssetId !== null && this.lastShownWasImage) {
        this.ghostUrl.set(this.imageUrl(this.lastResetAssetId));
        if (this.ghostTimer !== null) {
          clearTimeout(this.ghostTimer);
        }
        this.ghostTimer = setTimeout(() => this.ghostUrl.set(null), 340);
      }
      this.lastShownWasImage = this.current()?.mediaType === 'image';
      this.lastResetAssetId = assetId;
      this.stopPreparePolling();
      this.isPreparingVideo.set(false);
      this.isImageLoading.set(true);
      this.imageFailed.set(false);
      this.motionPlaying.set(false);
      this.editingDate.set(false);
      this.editedCapturedAt.set(null);
      this.resetZoom();
    });
  }

  ngOnInit(): void {
    this.savedScrollY = window.scrollY;
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
    this.restoreScroll();
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

  /** The embedded clip of a motion photo. */
  motionUrl(assetId: string): string {
    return `${this.mediaBase()}/${assetId}/motion`;
  }

  /** True while the viewer is holding to play a motion photo's clip. */
  readonly motionPlaying = signal(false);

  /** Show the LIVE badge only on a still motion photo at rest (not zoomed). */
  readonly showMotionBadge = computed<boolean>(() => {
    const asset = this.current();
    return (
      asset?.mediaType === 'image' && (this.detail()?.motionPhoto ?? false) && this.zoom() === 1
    );
  });

  /** Press-and-hold the badge to play the clip; release restores the still. */
  startMotion(event: Event): void {
    event.preventDefault();
    if (this.showMotionBadge()) {
      this.motionPlaying.set(true);
    }
  }

  stopMotion(): void {
    this.motionPlaying.set(false);
  }

  /** The playback route answered 202 (transcoding): show status and poll. */
  onVideoError(): void {
    const asset = this.current();
    if (!asset || asset.mediaType !== 'video' || this.isPreparingVideo() || this.videoDamaged()) {
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
      this.navDirection.set('forward');
      this.index.update((value) => value + 1);
    }
  }

  previous(): void {
    if (this.index() > 0) {
      this.navDirection.set('backward');
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
      // Videos keep their native controls (no capture, no preventDefault),
      // but a horizontal swipe across the picture still navigates. The
      // bottom strip is exempt — that's the seek bar.
      const stage = (event.currentTarget as HTMLElement).getBoundingClientRect();
      if (event.clientY < stage.bottom - VIDEO_CONTROLS_STRIP_PX) {
        this.videoSwipeStart = { x: event.clientX, y: event.clientY };
      }
      return;
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
    if (this.videoSwipeStart) {
      const deltaX = event.clientX - this.videoSwipeStart.x;
      const deltaY = event.clientY - this.videoSwipeStart.y;
      this.videoSwipeStart = null;
      // Horizontal and decisive — vertical drags and taps stay the video's.
      if (Math.abs(deltaX) > SWIPE_THRESHOLD_PX && Math.abs(deltaX) > Math.abs(deltaY) * 1.5) {
        if (deltaX < 0) {
          this.next();
        } else {
          this.previous();
        }
      }
      return;
    }
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

  /** Creating share links needs the write grant (matches the server). */
  get canShare(): boolean {
    return this.allowInfo() && this.canWrite;
  }

  /** Opens the 360° view: full-sphere pan/zoom via pannellum (bundled). */
  async openSphere(): Promise<void> {
    const asset = this.current();
    if (!asset) {
      return;
    }
    this.showSphere.set(true);
    // pannellum attaches itself to window; the import is a side effect.
    await import('pannellum');
    setTimeout(() => {
      const host = document.getElementById('sphere-host');
      const pannellum = (window as unknown as { pannellum?: { viewer: Function } }).pannellum;
      if (!host || !pannellum) {
        return;
      }
      this.sphereViewer?.destroy();
      this.sphereViewer = pannellum.viewer('sphere-host', {
        type: 'equirectangular',
        panorama: `${this.mediaBase()}/${asset.id}/original`,
        autoLoad: true,
        showFullscreenCtrl: false,
        autoRotate: -3,
      }) as { destroy: () => void };
    }, 0);
  }

  closeSphere(): void {
    this.sphereViewer?.destroy();
    this.sphereViewer = null;
    this.showSphere.set(false);
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

  // --- Capture-date correction (write grant) ---------------------------------

  /** True while the info panel's date is being edited. */
  readonly editingDate = signal(false);
  readonly savingDate = signal(false);
  /** A locally-applied corrected date, so the panel updates without a reload. */
  readonly editedCapturedAt = signal<string | null>(null);
  /** Bound to the datetime-local input, "YYYY-MM-DDTHH:MM". */
  dateDraft = '';

  /** The date to show — a just-saved correction wins over the loaded value. */
  displayCapturedAt(iso: string): string {
    return this.editedCapturedAt() ?? iso;
  }

  startEditDate(): void {
    const asset = this.current();
    if (!asset) {
      return;
    }
    this.dateDraft = toLocalInputValue(this.editedCapturedAt() ?? asset.capturedAt);
    this.editingDate.set(true);
  }

  cancelEditDate(): void {
    this.editingDate.set(false);
  }

  async saveDate(): Promise<void> {
    const asset = this.current();
    if (!asset || this.savingDate() || !this.dateDraft) {
      return;
    }
    const local = new Date(this.dateDraft);
    if (Number.isNaN(local.getTime())) {
      this.toasts.error('That date is not valid.');
      return;
    }
    this.savingDate.set(true);
    try {
      await firstValueFrom(
        this.http.patch(`/api/v1/assets/${asset.id}/captured-at`, {
          capturedAt: local.toISOString(),
          tzOffsetMin: -local.getTimezoneOffset(),
        }),
      );
      this.editedCapturedAt.set(local.toISOString());
      this.editingDate.set(false);
      this.toasts.success('Date updated — saved to the file too.');
    } catch {
      this.toasts.error("Couldn't update the date.");
    } finally {
      this.savingDate.set(false);
    }
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
    this.detailLoading.set(true);
    try {
      const detail = await firstValueFrom(
        this.http.get<AssetDetail>(`/api/v1/assets/${assetId}/detail`),
      );
      if (this.current()?.id === assetId) {
        this.detail.set(detail);
      }
    } catch {
      // The info sheet simply stays empty when detail cannot load.
    } finally {
      if (this.current()?.id === assetId) {
        this.detailLoading.set(false);
      }
    }
  }
}

/** ISO → "YYYY-MM-DDTHH:MM" in local time, for a datetime-local input. */
function toLocalInputValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}
