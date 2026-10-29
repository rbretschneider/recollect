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
import { describeError } from '../../core/describe-error';
import { formatCapturedDate } from '../../core/format-date';
import { AssetDetail, TimelineAsset } from '../../core/api/api-models';
import { inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { ShareButton } from '../../shared/share-button';
import { AlbumPicker } from '../../shared/album-picker';
import { MemoryPick, MemoryPicker } from '../../shared/memory-picker';
import { AssetDetailApiService } from '../../core/api/asset-detail-api.service';
import { PhotosApiService } from '../../core/api/photos-api.service';
import { AlbumsApiService } from '../../core/api/albums-api.service';
import { MemoriesApiService } from '../../core/api/memories-api.service';
import { TrashApiService } from '../../core/api/trash-api.service';
import { AuthStateService } from '../../core/auth/auth-state.service';
import { ConfirmService } from '../../shared/confirm.service';
import { ToastService } from '../../shared/toast.service';
import { Icon } from '../../shared/icon';
import { Sheet } from '../../shared/sheet';
import { ZoomGesture } from '../../shared/zoom-gesture';
import { AssetInfoPanel } from './asset-info-panel';

/** Minimum horizontal swipe distance (px) that counts as navigation. */
const SWIPE_THRESHOLD_PX = 60;

/** Bottom band of the stage reserved for the native video seek bar. */
const VIDEO_CONTROLS_STRIP_PX = 72;

/** How long the turning has to stop before the net rotation is saved. */
const ROTATE_SETTLE_MS = 900;

/**
 * Fullscreen media viewer (FRD story S4.3): swipe/arrow navigation, video
 * playback, and an info sheet. Rendered as an overlay above the current page.
 */
@Component({
  selector: 'app-asset-viewer',
  imports: [AlbumPicker, AssetInfoPanel, Icon, MemoryPicker, ShareButton, Sheet],
  templateUrl: './asset-viewer.html',
  styleUrl: './asset-viewer.scss',
})
export class AssetViewer implements OnInit, OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthStateService);
  private readonly photosApi = inject(PhotosApiService);
  private readonly assetDetailApi = inject(AssetDetailApiService);
  private readonly albumsApi = inject(AlbumsApiService);
  private readonly memoriesApi = inject(MemoriesApiService);
  private readonly trashApi = inject(TrashApiService);
  private readonly confirms = inject(ConfirmService);
  private readonly toasts = inject(ToastService);

  /** The list being browsed and the index to start at. */
  readonly assets = input.required<TimelineAsset[]>();
  readonly startIndex = input.required<number>();
  /** Base URL for media routes; share pages point this at their token scope. */
  readonly mediaBase = input<string>('/api/v1/assets');
  /** Lets a public share offer downloads; the library always allows them. */
  readonly allowDownload = input<boolean>(false);
  /**
   * Where "save this photo" points. The library has a route that serves the
   * file as an attachment; a share link streams the original through its own
   * token instead, since a guest can't reach the library route at all.
   */
  readonly downloadRoute = input<'download' | 'original'>('download');
  /** Info sheet requires the authed detail endpoint; share pages disable it. */
  readonly allowInfo = input<boolean>(true);
  /** Optional per-asset captions (memory scrapbook). Shown over the photo. */
  readonly captions = input<Record<string, string>>({});
  readonly closed = output<void>();
  /** Emitted after the current photo is moved to Trash from the viewer. */
  readonly deleted = output<string>();
  /** Emitted after a rotate lands, so the parent can refresh its copy. */
  readonly rotated = output<string>();

  readonly index = signal(0);
  readonly showInfo = signal(false);
  readonly detail = signal<AssetDetail | null>(null);
  /** True while the info panel's metadata is being fetched (show a spinner). */
  readonly detailLoading = signal(false);
  /** True while the server is transcoding this video for playback. */
  readonly isPreparingVideo = signal(false);
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

  /** Pinch/scroll zoom + pan, shared with the slideshow. 1 = fitted. */
  private readonly gesture = new ZoomGesture();
  readonly zoom = this.gesture.zoom;
  readonly isGestureActive = this.gesture.isActive;
  readonly mediaTransform = this.gesture.transform;

  /**
   * The optimistic turn rides the INDEPENDENT rotate property, not transform.
   * transform is transitioned for zoom/pan smoothing, so animating a quarter
   * turn through it made one tap read as the photo swinging twice — once for
   * the turn, once when the saved file swapped in. rotate is not in that
   * transition list, so it snaps.
   */
  readonly mediaRotate = computed(() => `${this.previewTurns() * 90}deg`);

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
      this.flushPendingRotation();
      this.editedCapturedAt.set(null);
      this.editedTitle.set(undefined);
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
    this.flushPendingRotation();
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
    // Busted by the asset version so a rotate shows immediately rather than
    // being served from the year-long immutable cache.
    const version =
      this.localVersions().get(assetId) ??
      this.assets().find((item) => item.id === assetId)?.updatedAt;
    return this.thumbUrlFor(assetId, version);
  }

  private thumbUrlFor(assetId: string, version: string | undefined): string {
    const bust = version ? `?v=${encodeURIComponent(version)}` : '';
    return `${this.mediaBase()}/${assetId}/thumb/1440${bust}`;
  }

  private clearTurn(assetId: string): void {
    this.rotationTurns.update((map) => {
      const next = new Map(map);
      next.delete(assetId);
      return next;
    });
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
    // 'control' (the motion-photo badge) is left entirely alone; capturing it
    // would steal the pointerup its own hold-to-play handler needs.
    if (this.gesture.pointerDown(event) === 'video') {
      // Videos keep their native controls (no capture, no preventDefault),
      // but a horizontal swipe across the picture still navigates. The
      // bottom strip is exempt — that's the seek bar.
      const stage = (event.currentTarget as HTMLElement).getBoundingClientRect();
      if (event.clientY < stage.bottom - VIDEO_CONTROLS_STRIP_PX) {
        this.videoSwipeStart = { x: event.clientX, y: event.clientY };
      }
    }
  }

  onPointerMove(event: PointerEvent): void {
    this.gesture.pointerMove(event);
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
    const swipe = this.gesture.pointerUp(event);
    if (swipe === 'next') {
      this.next();
    } else if (swipe === 'previous') {
      this.previous();
    }
  }

  /** Desktop: scroll wheel zooms toward the cursor. */
  onWheel(event: WheelEvent): void {
    this.gesture.wheel(event);
  }

  /** Double tap / double click toggles between fitted and zoomed-in. */
  onDoubleClick(event: MouseEvent): void {
    this.gesture.doubleClick(event);
  }

  /** Anywhere that isn't the media or a control closes the viewer. */
  onStageClick(event: MouseEvent): void {
    if (this.gesture.consumedClick) {
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

  private resetZoom(): void {
    this.gesture.reset();
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

  /**
   * Saving a photo. Household members always can; a share link can opt in, so
   * "can you send me that one?" has an answer that isn't a screenshot.
   */
  get canDownload(): boolean {
    return this.allowInfo() || this.allowDownload();
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

  /** Rotation is only offered for stills that carry an orientation tag. */
  readonly actionsOpen = signal(false);

  /** Only offer the overflow when it would actually hold something. */
  get hasMoreActions(): boolean {
    return this.canRotate || this.canDelete || this.canFile;
  }

  /**
   * Filing the photo you are looking at. Available wherever the viewer is —
   * a search hit, a person, a memory — so finding a photo and keeping it are
   * never two separate journeys. Never on a public share, which has no user.
   */
  get canFile(): boolean {
    return this.canWrite;
  }

  readonly isPickingAlbum = signal(false);
  readonly isPickingMemory = signal(false);

  /** The one photo on screen, as the pickers want it. */
  readonly currentIds = computed<string[]>(() => {
    const asset = this.current();
    return asset ? [asset.id] : [];
  });

  startAlbumPick(): void {
    this.actionsOpen.set(false);
    this.isPickingAlbum.set(true);
  }

  startMemoryPick(): void {
    this.actionsOpen.set(false);
    this.isPickingMemory.set(true);
  }

  async addCurrentToAlbum(albumId: string): Promise<void> {
    const ids = this.currentIds();
    this.isPickingAlbum.set(false);
    if (ids.length === 0) {
      return;
    }
    try {
      await this.albumsApi.addAssets(albumId, ids);
      this.toasts.success('Added to the album.');
    } catch (error) {
      this.toasts.error(describeError(error, 'Couldn’t add that photo to the album.'), {
        label: 'Retry',
        run: () => void this.addCurrentToAlbum(albumId),
      });
    }
  }

  async addCurrentToMemory(pick: MemoryPick): Promise<void> {
    const ids = this.currentIds();
    this.isPickingMemory.set(false);
    // A new memory was created around this photo already; adding it again
    // would be a second write for no change.
    if (pick.alreadyAdded) {
      this.toasts.success('Memory created.');
      return;
    }
    if (ids.length === 0) {
      return;
    }
    try {
      await this.memoriesApi.addAssets(pick.memoryId, ids);
      this.toasts.success('Added to the memory.');
    } catch (error) {
      this.toasts.error(describeError(error, 'Couldn’t add that photo to the memory.'), {
        label: 'Retry',
        run: () => void this.addCurrentToMemory(pick),
      });
    }
  }

  /** Runs an overflow action and closes the sheet behind it. */
  runAction(action: 'cw' | 'ccw' | 'trash'): void {
    if (action === 'trash') {
      this.actionsOpen.set(false);
      void this.deleteCurrent();
      return;
    }
    // Landing on the right orientation often takes two or three taps - if the
    // first guess was the wrong way round it takes three. Closing the sheet on
    // every tap made the common case the expensive one, so it stays open until
    // it is dismissed; the turns debounce into one save either way.
    this.rotateCurrent(action);
  }

  get canRotate(): boolean {
    const asset = this.current();
    if (!this.canWrite || !this.allowInfo() || asset?.mediaType !== 'image') {
      return false;
    }
    // mime is absent whenever the viewer was opened from a synthetic list
    // (toViewerAsset fills only id/mediaType) — which is most of the app, so
    // testing it directly hid the buttons everywhere but the photo grid.
    // Hide only when we positively know the format can't hold an orientation
    // tag; otherwise show and let the server be the judge.
    const mime = asset.mime ?? this.detail()?.mime;
    return mime === undefined || /^image\/(jpeg|heic|heif|tiff|avif)$/i.test(mime);
  }

  /** Quarter-turns applied locally per asset, so a photo turns instantly and
   *  stays turned while its save is still in flight. */
  private readonly rotationTurns = signal<ReadonlyMap<string, number>>(new Map());
  /** Cache-bust stamps for photos rotated in this session. */
  private readonly localVersions = signal<ReadonlyMap<string, string>>(new Map());
  /** Serialises writes to a given file without ever blocking the click. */
  private rotateQueue: Promise<unknown> = Promise.resolve();
  /** Un-saved net quarter turns per asset, flushed once the tapping stops. */
  private readonly pendingTurns = new Map<string, number>();
  private rotateTimer: ReturnType<typeof setTimeout> | null = null;

  readonly previewTurns = computed<number>(() => {
    const asset = this.current();
    return asset ? (this.rotationTurns().get(asset.id) ?? 0) : 0;
  });

  /**
   * Turns the photo a quarter turn and persists it.
   *
   * The on-screen image turns immediately via a CSS transform while the request
   * is in flight — the write itself is lossless (only the EXIF orientation tag
   * changes) but it still has to cross the network and regenerate thumbnails.
   */
  rotateCurrent(direction: 'cw' | 'ccw'): void {
    const asset = this.current();
    if (!asset) {
      return;
    }
    const id = asset.id;
    const delta = direction === 'cw' ? 1 : -1;
    // Turn it on screen NOW. The save is a background detail; making someone
    // watch a spinner to see their own photo turn is the wrong trade.
    this.turnBy(id, delta);
    this.pendingTurns.set(id, (this.pendingTurns.get(id) ?? 0) + delta);
    // Getting somewhere usually takes two or three taps — and overshooting then
    // coming back is normal. Saving each tap would rewrite the file, rehash it
    // and rebuild its thumbnails every time; instead wait for the turning to
    // stop and save the net result once.
    if (this.rotateTimer !== null) {
      clearTimeout(this.rotateTimer);
    }
    this.rotateTimer = setTimeout(() => this.flushRotation(id), ROTATE_SETTLE_MS);
  }

  /** Saves the net rotation for one photo, if it ended up anywhere new. */
  private flushRotation(assetId: string): void {
    this.rotateTimer = null;
    const turns = this.pendingTurns.get(assetId) ?? 0;
    this.pendingTurns.delete(assetId);
    if (turns % 4 === 0) {
      return; // Turned full circle (or back where it started): nothing to save.
    }
    // Writes to one file must not overlap (exiftool rewrites it in place), so
    // they queue — but the queue is never awaited by the click handler.
    this.rotateQueue = this.rotateQueue
      .then(() => firstValueFrom(this.http.post(`/api/v1/assets/${assetId}/rotate`, { turns })))
      .then(() => {
        // The saved file now carries the rotation in its EXIF, so the browser
        // will orient it itself. Swapping the src while the optimistic CSS turn
        // is still applied stacks the two — the photo visibly swings to double
        // the angle and back. Preload first, then change the src and drop the
        // turn in the same tick, so the two never overlap by even a frame.
        const version = Date.now().toString();
        const preload = new Image();
        preload.onload = () => {
          this.localVersions.update((map) => new Map(map).set(assetId, version));
          this.clearTurn(assetId);
        };
        // If it can't be fetched, keep the CSS turn: the file saved fine, and a
        // turned-by-CSS photo beats one that snaps back to looking unrotated.
        preload.onerror = () => undefined;
        preload.src = this.thumbUrlFor(assetId, version);
        this.rotated.emit(assetId);
      })
      .catch((error: { error?: { message?: string } }) => {
        this.turnBy(assetId, -turns);
        this.toasts.error(error?.error?.message ?? "Couldn't save that rotation.");
      });
  }

  /** Commits any un-saved turning immediately (navigating away, closing). */
  private flushPendingRotation(): void {
    if (this.rotateTimer === null) {
      return;
    }
    clearTimeout(this.rotateTimer);
    this.rotateTimer = null;
    for (const assetId of [...this.pendingTurns.keys()]) {
      this.flushRotation(assetId);
    }
  }

  private turnBy(assetId: string, delta: number): void {
    this.rotationTurns.update((map) => {
      const next = new Map(map);
      const turns = (next.get(assetId) ?? 0) + delta;
      if (turns % 4 === 0) {
        next.delete(assetId);
      } else {
        next.set(assetId, turns);
      }
      return next;
    });
  }

  /**
   * Clears the optimistic turn once the re-fetched file is on screen — and only
   * then, so a plain navigation back to the photo doesn't drop it early.
   */
  onImageLoaded(_assetId: string): void {
    this.isImageLoading.set(false);
  }

  /** Saves the original with its friendly server-assigned name. */
  downloadCurrent(): void {
    const asset = this.current();
    if (!asset) {
      return;
    }
    const anchor = document.createElement('a');
    anchor.href = `${this.mediaBase()}/${asset.id}/${this.downloadRoute()}`;
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

  formatDate(iso: string): string {
    return formatCapturedDate(iso);
  }

  // --- Edits made in the info panel, mirrored here for the caption band -----

  /** A locally-applied corrected date, so the panel updates without a reload. */
  readonly editedCapturedAt = signal<string | null>(null);
  /** A locally-applied title, so the caption updates without a reload. */
  readonly editedTitle = signal<string | null | undefined>(undefined);

  /** The title to show - a just-saved edit wins over the loaded value. */
  readonly displayTitle = computed<string | null>(() => {
    const edited = this.editedTitle();
    return edited !== undefined ? edited : (this.detail()?.title ?? null);
  });

  private async loadDetail(assetId: string): Promise<void> {
    this.detailLoading.set(true);
    try {
      const detail = await this.assetDetailApi.get(assetId);
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

