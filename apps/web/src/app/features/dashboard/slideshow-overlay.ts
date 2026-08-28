import { Component, computed, effect, input, OnDestroy, output, signal } from '@angular/core';
import { Icon } from '../../shared/icon';

/** One slide. */
export interface SlideItem {
  id: string;
  mediaType: 'image' | 'video';
}

/** How long each photo holds the screen. Videos hold until they finish. */
const IMAGE_HOLD_MS = 3800;

/** Bundled public-domain tracks (Wikimedia Commons, PD performances). */
const MUSIC_TRACKS = [
  'audio/gymnopedie-1.m4a',
  'audio/clair-de-lune.m4a',
  'audio/gymnopedie-3.m4a',
  'audio/maple-leaf-rag.m4a',
  'audio/the-entertainer.m4a',
  'audio/hungarian-dance-1.m4a',
  'audio/hungarian-dance-4.m4a',
  'audio/waltz-of-the-flowers.m4a',
  'audio/turkey-in-the-straw.m4a',
  'audio/washington-post-march.m4a',
];

/** A fresh shuffled play order for each show — every track before any repeat. */
function shuffledTracks(): string[] {
  const order = [...MUSIC_TRACKS];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}
const MUSIC_PREF_KEY = 'recollect.slideshowMusic';
const MUSIC_VOLUME = 0.35;

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
  /** Base URL for media routes; public pages point this at their token scope. */
  readonly mediaBase = input<string>('/api/v1/assets');
  readonly closed = output<void>();

  readonly index = signal(0);
  readonly isPaused = signal(false);
  /** True after the last slide: the show stops and offers a replay. */
  readonly isFinished = signal(false);
  readonly current = computed<SlideItem | null>(() => this.items()[this.index()] ?? null);
  /** Single-item list so @for track recreates the element (crossfade). */
  readonly currentAsList = computed<SlideItem[]>(() => {
    const item = this.current();
    return item ? [item] : [];
  });

  private timer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Background music, strictly fire-and-forget (prime directive: the show
   * NEVER waits for it) — slides start instantly, audio joins whenever it's
   * buffered, and it ducks out while a video's own sound plays.
   */
  readonly musicOn = signal(this.loadMusicPref());
  private audio: HTMLAudioElement | null = null;
  private readonly playlist = shuffledTracks();
  private trackIndex = 0;

  constructor() {
    effect(() => {
      const item = this.current();
      const paused = this.isPaused();
      const finished = this.isFinished();
      this.clearTimer();
      // Videos advance themselves via (ended); photos ride the clock.
      if (item && item.mediaType === 'image' && !paused && !finished) {
        this.timer = setTimeout(() => this.next(), IMAGE_HOLD_MS);
      }
      // Music ducks for videos, pause, and the end card.
      if (this.audio) {
        if (!this.musicOn() || paused || finished || item?.mediaType === 'video') {
          this.audio.pause();
        } else {
          void this.audio.play().catch(() => undefined);
        }
      }
    });
    // Kick the music off the open tap — but never gate anything on it.
    if (this.musicOn()) {
      this.startMusic();
    }
  }

  ngOnDestroy(): void {
    this.clearTimer();
    this.audio?.pause();
    this.audio = null;
  }

  toggleMusic(): void {
    const next = !this.musicOn();
    this.musicOn.set(next);
    try {
      localStorage.setItem(MUSIC_PREF_KEY, next ? 'on' : 'off');
    } catch {
      // Storage refused; the toggle still works for this show.
    }
    if (next && !this.audio) {
      this.startMusic();
    }
  }

  private startMusic(): void {
    const audio = new Audio(this.playlist[this.trackIndex % this.playlist.length]);
    audio.volume = MUSIC_VOLUME;
    audio.addEventListener('ended', () => {
      this.trackIndex += 1;
      audio.src = this.playlist[this.trackIndex % this.playlist.length];
      void audio.play().catch(() => undefined);
    });
    this.audio = audio;
    void audio.play().catch(() => undefined);
  }

  private loadMusicPref(): boolean {
    try {
      return localStorage.getItem(MUSIC_PREF_KEY) !== 'off';
    } catch {
      return true;
    }
  }

  imageUrl(id: string): string {
    return `${this.mediaBase()}/${id}/thumb/1440`;
  }

  videoUrl(id: string): string {
    return `${this.mediaBase()}/${id}/playback`;
  }

  next(): void {
    // The end is the end: stop and offer a replay instead of looping.
    if (this.index() >= this.items().length - 1) {
      this.isFinished.set(true);
      return;
    }
    this.index.update((value) => value + 1);
  }

  previous(): void {
    if (this.isFinished()) {
      this.isFinished.set(false);
      return;
    }
    this.index.update((value) => Math.max(0, value - 1));
  }

  replay(): void {
    this.isFinished.set(false);
    this.isPaused.set(false);
    this.index.set(0);
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
