import { Component, computed, DestroyRef, effect, HostListener, inject, input, OnDestroy, output, signal, viewChild } from '@angular/core';
import { AlbumsApiService } from '../../core/api/albums-api.service';
import { Icon } from '../../shared/icon';
import { Sheet } from '../../shared/sheet';
import { ShareButton } from '../../shared/share-button';
import { ToastService } from '../../shared/toast.service';
import { closeOnBrowserBack } from '../../shared/close-on-back';

/** One slide. */
export interface SlideItem {
  id: string;
  mediaType: 'image' | 'video';
  /** Optional scrapbook caption, shown over the foot of the slide. */
  caption?: string;
}

/** The shareable thing a slideshow is playing, when there is one. */
export interface SlideshowCollection {
  /** Used as the album name if this has to be materialised to be shared. */
  title: string;
  kind: 'memory' | 'place' | 'person';
  /** Set for memory moments — shared directly, no album needed. */
  memoryId: string | null;
  assetIds: string[];
}

/** How long each photo holds the screen. Videos hold until they finish. */
const IMAGE_HOLD_MS = 3800;

/**
 * Bundled public-domain tracks (Wikimedia Commons, PD performances). All mellow
 * on purpose — quiet Satie/Debussy/Chopin, the kind of unobtrusive backdrop that
 * lets the photos carry the moment rather than a marching band.
 */
const MUSIC_TRACKS = [
  'audio/gymnopedie-1.m4a',
  'audio/gymnopedie-2.m4a',
  'audio/gymnopedie-3.m4a',
  'audio/gnossienne-1.m4a',
  'audio/gnossienne-2.m4a',
  'audio/gnossienne-3.m4a',
  'audio/gnossienne-4.m4a',
  'audio/gnossienne-5.m4a',
  'audio/gnossienne-6.m4a',
  'audio/gnossienne-7.m4a',
  'audio/clair-de-lune.m4a',
  'audio/chopin-nocturne-21.m4a',
  'audio/air-on-g-string.m4a',
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
  imports: [Icon, Sheet, ShareButton],
  templateUrl: './slideshow-overlay.html',
  styleUrl: './slideshow-overlay.scss',
})
export class SlideshowOverlay implements OnDestroy {
  readonly items = input.required<SlideItem[]>();
  readonly title = input<string>('');
  /** Base URL for media routes; public pages point this at their token scope. */
  readonly mediaBase = input<string>('/api/v1/assets');
  /**
   * What this show is OF, when it's something shareable. Set it and a share
   * button appears; leave it null (public pages, ad-hoc strips) and it doesn't.
   */
  readonly collection = input<SlideshowCollection | null>(null);
  readonly closed = output<void>();

  private readonly albums = inject(AlbumsApiService);
  private readonly toasts = inject(ToastService);
  private readonly photoShare = viewChild<ShareButton>('photoShare');
  private readonly collectionShare = viewChild<ShareButton>('collectionShare');

  readonly shareChoiceOpen = signal(false);
  readonly resolvingCollection = signal(false);
  /** Resolved lazily — a place/person moment only becomes an album if asked. */
  readonly collectionTarget = signal<{ targetType: 'memory' | 'album'; targetId: string } | null>(
    null,
  );

  readonly currentAssetId = computed<string | null>(() => this.current()?.id ?? null);
  readonly collectionNoun = computed<string>(() =>
    this.collection()?.kind === 'memory' ? 'memory' : 'look-back',
  );

  openShareChoice(): void {
    this.isPaused.set(true); // Don't let slides advance under the sheet.
    this.shareChoiceOpen.set(true);
  }

  async shareCurrentPhoto(): Promise<void> {
    this.shareChoiceOpen.set(false);
    await this.photoShare()?.open();
  }

  /**
   * A look-back is computed, not stored, so it needs a real target to share.
   * A memory moment already is one; anything else is materialised as an album
   * the first time — which also gives the household something to manage later.
   */
  async shareWholeCollection(): Promise<void> {
    const coll = this.collection();
    if (!coll || this.resolvingCollection()) {
      return;
    }
    if (!this.collectionTarget()) {
      this.resolvingCollection.set(true);
      try {
        if (coll.kind === 'memory' && coll.memoryId) {
          this.collectionTarget.set({ targetType: 'memory', targetId: coll.memoryId });
        } else {
          const { albumId } = await this.albums.create(coll.title, coll.assetIds);
          this.collectionTarget.set({ targetType: 'album', targetId: albumId });
        }
      } catch {
        this.toasts.error("Couldn't prepare that for sharing.");
        return;
      } finally {
        this.resolvingCollection.set(false);
      }
    }
    this.shareChoiceOpen.set(false);
    // The share button only exists once its target input is set, so let the
    // template render before reaching for it.
    await Promise.resolve();
    await this.collectionShare()?.open();
  }

  readonly index = signal(0);
  readonly isPaused = signal(false);
  /** True after the last slide: the show stops and offers a replay. */
  readonly isFinished = signal(false);
  readonly current = computed<SlideItem | null>(() => this.items()[this.index()] ?? null);
  /** The caption for the slide on screen — shown only while it's a paused/held
   *  image, never over a playing video's own controls. */
  readonly currentCaption = computed<string>(() => this.current()?.caption ?? '');
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
    // Android/browser Back closes the show, never the page underneath.
    closeOnBrowserBack(inject(DestroyRef), () => this.close());
  }

  @HostListener('document:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    switch (event.key) {
      case 'Escape':
        this.close();
        break;
      case 'ArrowRight':
        this.next();
        break;
      case 'ArrowLeft':
        this.previous();
        break;
      case ' ':
        event.preventDefault();
        this.togglePause();
        break;
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
