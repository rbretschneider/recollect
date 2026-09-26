import { Component, computed, DestroyRef, effect, HostListener, inject, input, OnDestroy, output, signal, viewChild } from '@angular/core';
import { describeError } from '../../core/describe-error';
import { AlbumsApiService } from '../../core/api/albums-api.service';
import { TrashApiService } from '../../core/api/trash-api.service';
import { AuthStateService } from '../../core/auth/auth-state.service';
import { Icon } from '../../shared/icon';
import { Sheet } from '../../shared/sheet';
import { ShareButton } from '../../shared/share-button';
import { ConfirmService } from '../../shared/confirm.service';
import { ToastService } from '../../shared/toast.service';
import { closeOnBrowserBack } from '../../shared/close-on-back';
import { ZoomGesture } from '../../shared/zoom-gesture';

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
  /**
   * Where a signed-in household member should land for this collection. A
   * look-back has no row of its own, so its page URL stands in — and sending
   * the family a link must not create an album just to have something to
   * point at.
   */
  internalPath?: string;
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
  /**
   * Opt in to the per-photo actions menu. Off by default and deliberately not
   * inferred from anything: this overlay also plays on the public share page
   * and the guest contribute page, and a destructive control has no business
   * rendering there even for a moment. Private pages pass it explicitly.
   */
  readonly allowActions = input(false);
  readonly closed = output<void>();
  /** A photo left the library; parents drop it from their own lists. */
  readonly deleted = output<string>();

  private readonly albums = inject(AlbumsApiService);
  private readonly trashApi = inject(TrashApiService);
  private readonly auth = inject(AuthStateService);
  private readonly confirms = inject(ConfirmService);
  private readonly toasts = inject(ToastService);
  private readonly photoShare = viewChild<ShareButton>('photoShare');
  private readonly collectionShare = viewChild<ShareButton>('collectionShare');

  readonly shareChoiceOpen = signal(false);
  /** "Open the collection's share panel as soon as that button exists." */
  private readonly pendingCollectionShare = signal(false);
  /** Resolved lazily — a place/person moment only becomes an album if asked. */
  readonly collectionTarget = signal<{ targetType: 'memory' | 'album'; targetId: string } | null>(
    null,
  );

  readonly currentAssetId = computed<string | null>(() => this.current()?.id ?? null);

  /**
   * Turns a computed look-back into a real album, so a public token has
   * something to point at. Passed to the share panel rather than called up
   * front: choosing to expose it is what creates the album, and a household
   * link never does.
   */
  readonly materialiseAlbum = async (): Promise<string> => {
    const coll = this.collection();
    if (!coll) {
      throw new Error('Nothing to share.');
    }
    const { albumId } = await this.albums.create(coll.title, coll.assetIds);
    return albumId;
  };

  /** Where a household member lands for the whole collection. */
  readonly collectionInternalPath = computed<string | null>(
    () => this.collection()?.internalPath ?? null,
  );
  readonly collectionNoun = computed<string>(() =>
    this.collection()?.kind === 'memory' ? 'memory' : 'look-back',
  );

  openShareChoice(): void {
    this.isPaused.set(true); // Don't let slides advance under the sheet.
    this.shareChoiceOpen.set(true);
  }

  // --- Per-photo actions -----------------------------------------------------

  readonly actionsOpen = signal(false);
  readonly isTrashing = signal(false);

  /** Anyone who can change the library sees the menu. */
  get canWrite(): boolean {
    const permission = this.auth.user()?.permission;
    return permission === 'write' || permission === 'delete';
  }

  /** Trashing is its own grant, and the server enforces it too. */
  get canDelete(): boolean {
    return this.auth.user()?.permission === 'delete';
  }

  get showActions(): boolean {
    return this.allowActions() && this.canWrite;
  }

  /**
   * The show advances on a timer, so opening this without pausing would let the
   * slide change between the tap and the confirm - and the confirm names the
   * photo you were looking at, not the one that has since arrived.
   */
  openActions(): void {
    this.isPaused.set(true);
    this.actionsOpen.set(true);
  }

  /** Stays paused on close: you opened this to deal with a photo, not to watch. */
  closeActions(): void {
    this.actionsOpen.set(false);
  }

  async trashCurrent(): Promise<void> {
    const asset = this.current();
    if (!asset || this.isTrashing()) {
      return;
    }
    // Drop the sheet before asking, so the confirm isn't a second modal
    // stacked on the first. The show stays paused either way.
    this.actionsOpen.set(false);
    const confirmed = await this.confirms.ask({
      title: 'Move this photo to Trash?',
      message:
        'It leaves your library now and is permanently deleted after the holding period. You can restore it from Trash until then.',
      confirmLabel: 'Move to Trash',
    });
    if (!confirmed) {
      return;
    }
    this.isTrashing.set(true);
    try {
      await this.trashApi.trashAssets([asset.id]);
    } catch (error) {
      this.toasts.error(describeError(error, "Couldn't move that photo to Trash."));
      return;
    } finally {
      this.isTrashing.set(false);
    }

    // Step off the slide before it disappears from under the index, so the
    // show lands on a real neighbour rather than past the end.
    const wasLast = this.index() >= this.slides().length - 1;
    this.removedIds.update((set) => new Set(set).add(asset.id));
    if (this.slides().length === 0) {
      this.close();
    } else if (wasLast) {
      this.index.set(this.slides().length - 1);
    }
    this.isFinished.set(false);
    this.deleted.emit(asset.id);
    this.toasts.success('Moved to Trash.');
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
    if (!coll) {
      return;
    }
    // A memory already IS a shareable thing. Anything else is computed, and
    // is materialised only if someone actually creates a public link — see
    // `materialiseAlbum`, handed to the share panel as its resolver.
    this.collectionTarget.set(
      coll.kind === 'memory' && coll.memoryId
        ? { targetType: 'memory', targetId: coll.memoryId }
        : { targetType: 'album', targetId: '' },
    );
    this.shareChoiceOpen.set(false);
    // Don't race the renderer. This share button only comes into existence
    // once its target is set, and one microtask is not a promise that Angular
    // has rendered it — when it hadn't, `collectionShare()` was undefined and
    // `?.open()` quietly did nothing at all. Ask instead, and let the effect
    // below open it the moment it exists.
    this.pendingCollectionShare.set(true);
  }

  readonly index = signal(0);
  readonly isPaused = signal(false);
  /** True after the last slide: the show stops and offers a replay. */
  readonly isFinished = signal(false);

  /**
   * Trashed during this show. `items` is an input and stays as the caller gave
   * it, so the deleted slide is filtered out here — every count, dot, arrow and
   * bound is taken from `slides`, never from the raw input, or the show would
   * keep a hole where the photo used to be.
   */
  private readonly removedIds = signal<ReadonlySet<string>>(new Set());
  readonly slides = computed<SlideItem[]>(() => {
    const removed = this.removedIds();
    return removed.size === 0 ? this.items() : this.items().filter((it) => !removed.has(it.id));
  });

  readonly current = computed<SlideItem | null>(() => this.slides()[this.index()] ?? null);
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
    // The collection's share button is rendered lazily, so opening it waits
    // for it to appear rather than assuming it already has.
    effect(() => {
      const button = this.collectionShare();
      if (button && this.pendingCollectionShare()) {
        this.pendingCollectionShare.set(false);
        void button.open();
      }
    });
    // A new slide always arrives fitted, whatever the last one was zoomed to.
    effect(() => {
      this.current();
      this.gesture.reset();
      this.hasZoomed.set(false);
    });
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
    if (this.index() >= this.slides().length - 1) {
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

  // --- Gestures: pinch / double-tap zoom, pan, swipe to steer ---------------

  /**
   * Same pinch/pan/double-tap as the asset viewer. Zooming in pauses the show:
   * a photo you're leaning into must not slide away under your fingers.
   */
  readonly gesture = new ZoomGesture();
  /**
   * Sticky for the rest of the slide once you've zoomed at all — NOT the same
   * as "currently zoomed".
   *
   * At rest a slide carries the Ken Burns drift, which is a 6s transform
   * transition. Keying the fast transition off `isZoomed()` meant the instant
   * you came back to 1x the class fell away, the inline transform was dropped,
   * and that last step home animated over those 6 seconds — zoom in snappy,
   * zoom out apparently broken. Once a slide has been handled, it keeps the
   * quick transition and its own transform until the next slide arrives.
   */
  readonly hasZoomed = signal(false);
  /** Videos have no zoom, so their swipes are tracked the plain way. */
  private videoSwipeStartX: number | null = null;
  private didSwipe = false;

  onPointerDown(event: PointerEvent): void {
    this.didSwipe = false;
    // 'control' — Replay on the end card — is left alone: capturing the
    // pointer here would make the browser fire the click on the stage instead
    // of on the button, which is exactly how Replay stopped working.
    if (this.gesture.pointerDown(event) === 'video') {
      this.videoSwipeStartX = event.clientX;
    }
  }

  onPointerMove(event: PointerEvent): void {
    this.gesture.pointerMove(event);
    this.onZoomChanged();
  }

  onPointerUp(event: PointerEvent): void {
    let swipe = this.gesture.pointerUp(event);
    if (this.videoSwipeStartX !== null) {
      const delta = event.clientX - this.videoSwipeStartX;
      this.videoSwipeStartX = null;
      if (Math.abs(delta) >= 50) {
        swipe = delta < 0 ? 'next' : 'previous';
      }
    }
    if (swipe === 'next') {
      this.didSwipe = true;
      this.next();
    } else if (swipe === 'previous') {
      this.didSwipe = true;
      this.previous();
    }
  }

  onWheel(event: WheelEvent): void {
    this.gesture.wheel(event);
    this.onZoomChanged();
  }

  onDoubleClick(event: MouseEvent): void {
    if (this.gesture.doubleClick(event)) {
      this.onZoomChanged();
    }
  }

  /** Zooming holds the show where it is, and marks the slide as handled. */
  private onZoomChanged(): void {
    if (this.gesture.isZoomed()) {
      this.hasZoomed.set(true);
      this.isPaused.set(true);
    }
  }

  onStageClick(event: MouseEvent): void {
    // The click after a swipe, pan or pinch is the same gesture — don't also
    // steer by zones. Zoomed in, the sides are picture, not buttons.
    if (this.didSwipe || this.gesture.consumedClick || this.gesture.isZoomed()) {
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
