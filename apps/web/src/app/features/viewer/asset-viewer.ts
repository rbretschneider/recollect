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
import { firstValueFrom } from 'rxjs';

/** Minimum horizontal swipe distance (px) that counts as navigation. */
const SWIPE_THRESHOLD_PX = 60;

/**
 * Fullscreen media viewer (FRD story S4.3): swipe/arrow navigation, video
 * playback, and an info sheet. Rendered as an overlay above the current page.
 */
@Component({
  selector: 'app-asset-viewer',
  imports: [],
  templateUrl: './asset-viewer.html',
  styleUrl: './asset-viewer.scss',
})
export class AssetViewer implements OnInit, OnDestroy {
  private readonly http = inject(HttpClient);

  /** The list being browsed and the index to start at. */
  readonly assets = input.required<TimelineAsset[]>();
  readonly startIndex = input.required<number>();
  /** Base URL for media routes; share pages point this at their token scope. */
  readonly mediaBase = input<string>('/api/v1/assets');
  /** Info sheet requires the authed detail endpoint; share pages disable it. */
  readonly allowInfo = input<boolean>(true);
  readonly closed = output<void>();

  readonly index = signal(0);
  readonly showInfo = signal(false);
  readonly detail = signal<AssetDetail | null>(null);
  /** True while the server is transcoding this video for playback. */
  readonly isPreparingVideo = signal(false);
  /** Bumped when a prepared rendition becomes available, to reload the <video>. */
  readonly videoReloadKey = signal(0);

  readonly current = computed<TimelineAsset | null>(() => this.assets()[this.index()] ?? null);

  private touchStartX: number | null = null;
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
      this.current(); // Moving to another item resets any preparing state.
      this.stopPreparePolling();
      this.isPreparingVideo.set(false);
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

  onTouchStart(event: TouchEvent): void {
    this.touchStartX = event.touches[0]?.clientX ?? null;
  }

  onTouchEnd(event: TouchEvent): void {
    if (this.touchStartX === null) {
      return;
    }
    const deltaX = (event.changedTouches[0]?.clientX ?? this.touchStartX) - this.touchStartX;
    this.touchStartX = null;
    if (deltaX < -SWIPE_THRESHOLD_PX) {
      this.next();
    } else if (deltaX > SWIPE_THRESHOLD_PX) {
      this.previous();
    }
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

  formatDate(iso: string): string {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: 'short' }).format(
      new Date(iso),
    );
  }

  formatSize(bytes: number | null): string {
    if (bytes === null) {
      return '';
    }
    const megabytes = bytes / (1024 * 1024);
    return `${megabytes.toFixed(1)} MB`;
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
