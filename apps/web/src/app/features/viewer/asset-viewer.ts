import {
  Component,
  computed,
  effect,
  HostListener,
  input,
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
export class AssetViewer {
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

  readonly current = computed<TimelineAsset | null>(() => this.assets()[this.index()] ?? null);

  private touchStartX: number | null = null;

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
  }

  imageUrl(assetId: string): string {
    return `${this.mediaBase()}/${assetId}/thumb/1440`;
  }

  originalUrl(assetId: string): string {
    return `${this.mediaBase()}/${assetId}/original`;
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
