import { Component, computed, effect, input, OnDestroy, output, signal } from '@angular/core';
import { Icon } from '../../shared/icon';

/** One slide. */
export interface SlideItem {
  id: string;
  mediaType: 'image' | 'video';
}

/** How long each photo holds the screen. Videos hold until they finish. */
const IMAGE_HOLD_MS = 3800;

/**
 * The memories slideshow: a fullscreen auto-advancing carousel. Photos
 * crossfade on a timer; a video plays through and the show waits for it.
 * Tap sides to steer, middle to pause, ✕ (or Escape) to leave.
 */
@Component({
  selector: 'app-slideshow-overlay',
  imports: [Icon],
  templateUrl: './slideshow-overlay.html',
  styleUrl: './slideshow-overlay.scss',
})
export class SlideshowOverlay implements OnDestroy {
  readonly items = input.required<SlideItem[]>();
  readonly title = input<string>('');
  readonly closed = output<void>();

  readonly index = signal(0);
  readonly isPaused = signal(false);
  readonly current = computed<SlideItem | null>(() => this.items()[this.index()] ?? null);
  /** Single-item list so @for track recreates the element (crossfade). */
  readonly currentAsList = computed<SlideItem[]>(() => {
    const item = this.current();
    return item ? [item] : [];
  });

  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    effect(() => {
      const item = this.current();
      const paused = this.isPaused();
      this.clearTimer();
      // Videos advance themselves via (ended); photos ride the clock.
      if (item && item.mediaType === 'image' && !paused) {
        this.timer = setTimeout(() => this.next(), IMAGE_HOLD_MS);
      }
    });
  }

  ngOnDestroy(): void {
    this.clearTimer();
  }

  imageUrl(id: string): string {
    return `/api/v1/assets/${id}/thumb/1440`;
  }

  videoUrl(id: string): string {
    return `/api/v1/assets/${id}/playback`;
  }

  next(): void {
    this.index.update((value) => (value + 1) % Math.max(1, this.items().length));
  }

  previous(): void {
    const count = Math.max(1, this.items().length);
    this.index.update((value) => (value - 1 + count) % count);
  }

  togglePause(): void {
    this.isPaused.update((value) => !value);
  }

  /** Swipe tracking: a real swipe navigates and swallows the tap. */
  private pointerStartX: number | null = null;
  private didSwipe = false;

  onPointerDown(event: PointerEvent): void {
    this.pointerStartX = event.clientX;
    this.didSwipe = false;
  }

  onPointerUp(event: PointerEvent): void {
    if (this.pointerStartX === null) {
      return;
    }
    const delta = event.clientX - this.pointerStartX;
    this.pointerStartX = null;
    if (Math.abs(delta) >= 50) {
      this.didSwipe = true;
      if (delta < 0) {
        this.next();
      } else {
        this.previous();
      }
    }
  }

  onStageClick(event: MouseEvent): void {
    // The click after a swipe is the same gesture — don't also steer by zones.
    if (this.didSwipe) {
      this.didSwipe = false;
      return;
    }
    const width = (event.currentTarget as HTMLElement).clientWidth;
    const x = event.clientX;
    if (x < width * 0.3) {
      this.previous();
    } else if (x > width * 0.7) {
      this.next();
    } else {
      this.togglePause();
    }
  }

  onVideoEnded(): void {
    if (!this.isPaused()) {
      this.next();
    }
  }

  /** A video still transcoding (202) or broken must not stall the show. */
  onVideoError(): void {
    this.timer = setTimeout(() => this.next(), 1500);
  }

  close(): void {
    this.clearTimer();
    this.closed.emit();
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
