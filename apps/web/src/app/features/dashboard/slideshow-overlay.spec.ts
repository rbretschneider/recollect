import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { AuthStateService } from '../../core/auth/auth-state.service';
import { FIXTURE_DETAIL, userWithPermission } from '../viewer/asset-detail.fixture';
import { AssetInfoPanel } from '../viewer/asset-info-panel';
import { SlideItem, SlideshowCollection, SlideshowOverlay } from './slideshow-overlay';

/**
 * Regression cover for the slideshow overlay.
 *
 * Every case here shipped broken: the un-zoom that crawled for six seconds,
 * "share the whole look-back" that did nothing at all, and a Pause that
 * stopped the slide clock while leaving the video playing — with no button on
 * screen to reach it with in the first place.
 */

const SLIDES: SlideItem[] = [
  { id: 'asset-1', mediaType: 'image' },
  { id: 'asset-2', mediaType: 'image' },
];

/** A video first, because that is the slide Pause used to ignore. */
const VIDEO_SLIDES: SlideItem[] = [
  { id: 'clip-1', mediaType: 'video' },
  { id: 'asset-2', mediaType: 'image' },
];

const LOOKBACK: SlideshowCollection = {
  title: 'Acadia, 2021',
  kind: 'place',
  memoryId: null,
  assetIds: ['asset-1', 'asset-2'],
  internalPath: '/lookback?day=09-25&year=2021',
};

function stageOf(fixture: ComponentFixture<SlideshowOverlay>): HTMLElement {
  return fixture.nativeElement.querySelector('.stage') as HTMLElement;
}

function wheelOver(stage: HTMLElement, deltaY: number): WheelEvent {
  const event = new MouseEvent('wheel', { bubbles: true, clientX: 200, clientY: 150 }) as unknown as WheelEvent;
  Object.defineProperty(event, 'deltaY', { value: deltaY });
  Object.defineProperty(event, 'preventDefault', { value: () => undefined });
  stage.dispatchEvent(event);
  return event;
}

describe('SlideshowOverlay', () => {
  let fixture: ComponentFixture<SlideshowOverlay>;
  let http: HttpTestingController;

  beforeEach(async () => {
    // jsdom does not implement media playback: play() returns undefined, and
    // the overlay's fire-and-forget `play().catch(...)` would throw on it.
    // The music is decoration here; what matters is that it never blocks.
    HTMLMediaElement.prototype.play = () => Promise.resolve();
    HTMLMediaElement.prototype.pause = () => undefined;

    await TestBed.configureTestingModule({
      imports: [SlideshowOverlay],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();

    // Write permission, so the share and actions chrome renders at all.
    TestBed.inject(AuthStateService).user.set({
      id: 'user-1',
      name: 'Test',
      email: 't@example.com',
      permission: 'delete',
      isAdmin: true,
    } as never);

    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(SlideshowOverlay);
    fixture.componentRef.setInput('items', SLIDES);
    fixture.componentRef.setInput('collection', LOOKBACK);
    fixture.componentRef.setInput('allowActions', true);
    fixture.detectChanges();
  });

  describe('zoom', () => {
    // THE REGRESSION: the fast transform transition was keyed on "is zoomed",
    // so returning to 1x handed the last step back to the stylesheet's 6s Ken
    // Burns transition and the picture crawled home.
    it('keeps the manual transform after zooming back out to 1x', () => {
      const stage = stageOf(fixture);
      wheelOver(stage, -100);
      fixture.detectChanges();

      expect(fixture.componentInstance.gesture.isZoomed()).toBe(true);
      expect(stage.classList.contains('manual')).toBe(true);

      // All the way home.
      for (let i = 0; i < 20; i++) {
        wheelOver(stage, 100);
      }
      fixture.detectChanges();

      expect(fixture.componentInstance.gesture.zoom()).toBe(1);
      expect(fixture.componentInstance.gesture.isZoomed()).toBe(false);
      // Still "manual", so the quick transition still applies and the slide
      // keeps an explicit transform rather than falling back to the drift.
      expect(stage.classList.contains('manual')).toBe(true);
      const image = stage.querySelector('img.slide') as HTMLElement;
      expect(image.style.transform).toContain('scale(1)');
    });

    it('hands the next slide back to the Ken Burns drift', () => {
      const stage = stageOf(fixture);
      wheelOver(stage, -100);
      fixture.detectChanges();
      expect(stage.classList.contains('manual')).toBe(true);

      fixture.componentInstance.next();
      fixture.detectChanges();

      expect(stage.classList.contains('manual')).toBe(false);
      const image = stage.querySelector('img.slide') as HTMLElement;
      expect(image.style.transform).toBe('');
    });

    it('pauses the show while you are zoomed in', () => {
      expect(fixture.componentInstance.isPaused()).toBe(false);
      wheelOver(stageOf(fixture), -100);
      expect(fixture.componentInstance.isPaused()).toBe(true);
    });
  });

  describe('pausing', () => {
    /** The labelled pill: the only thing on screen that says you can pause. */
    function pauseButton(): HTMLButtonElement {
      return fixture.nativeElement.querySelector('.playpause') as HTMLButtonElement;
    }

    /**
     * Element-own play/pause, so the video's own calls are counted apart from
     * the background music's — both ride the same prototype stubs.
     */
    function trackPlayback(video: HTMLVideoElement): string[] {
      const calls: string[] = [];
      video.play = () => (calls.push('play'), Promise.resolve());
      video.pause = () => void calls.push('pause');
      return calls;
    }

    // THE REGRESSION: pause was tap-the-middle-of-the-stage and the spacebar,
    // neither of which is visible. A three-second clip was over before anyone
    // could find it, so there was no way to hold it and reach Share.
    it('offers a labelled pause control throughout the show', () => {
      const button = pauseButton();
      expect(button).not.toBeNull();
      expect(button.textContent).toContain('Pause');

      button.click();
      fixture.detectChanges();

      expect(fixture.componentInstance.isPaused()).toBe(true);
      // Paused, it becomes the way back in rather than vanishing.
      expect(pauseButton().textContent).toContain('Play');

      pauseButton().click();
      fixture.detectChanges();
      expect(fixture.componentInstance.isPaused()).toBe(false);
    });

    // THE REGRESSION: the <video> was plain `autoplay` with nothing bound to
    // it, so pausing stopped the slide timer and the music and let the clip
    // play on to the end.
    it('pauses the video itself, not just the slide clock', () => {
      fixture.componentRef.setInput('items', VIDEO_SLIDES);
      fixture.detectChanges();

      const video = fixture.nativeElement.querySelector('video') as HTMLVideoElement;
      expect(video).not.toBeNull();
      const calls = trackPlayback(video);

      pauseButton().click();
      fixture.detectChanges();

      expect(calls).toEqual(['pause']);

      pauseButton().click();
      fixture.detectChanges();

      // Resumed where it stopped — no reload, no restart.
      expect(calls).toEqual(['pause', 'play']);
      expect(video.hasAttribute('src')).toBe(true);
    });

    // Opening Share is the whole reason she was reaching for Pause.
    it('holds the video while the share sheet is open', () => {
      fixture.componentRef.setInput('items', VIDEO_SLIDES);
      fixture.detectChanges();

      const video = fixture.nativeElement.querySelector('video') as HTMLVideoElement;
      const calls = trackPlayback(video);

      fixture.componentInstance.openShareChoice();
      fixture.detectChanges();

      expect(fixture.componentInstance.isPaused()).toBe(true);
      expect(calls).toEqual(['pause']);
    });

    it('stops the video on the end card', () => {
      fixture.componentRef.setInput('items', [VIDEO_SLIDES[0]]);
      fixture.detectChanges();

      const video = fixture.nativeElement.querySelector('video') as HTMLVideoElement;
      const calls = trackPlayback(video);

      // A one-slide show: the video ending is the end of the show.
      video.dispatchEvent(new Event('ended'));
      fixture.detectChanges();

      expect(fixture.componentInstance.isFinished()).toBe(true);
      expect(calls).toEqual(['pause']);
      // The pill steps aside for Replay rather than competing with it.
      expect(pauseButton()).toBeNull();
    });
  });

  describe('sharing the whole collection', () => {
    // THE REGRESSION: this share button is rendered only once its target is
    // set, and the old code awaited a single microtask before reaching for the
    // viewChild. When it was not there yet, `?.open()` silently did nothing.
    it('opens the share panel once the lazily-rendered button exists', async () => {
      fixture.componentInstance.openShareChoice();
      fixture.detectChanges();

      await fixture.componentInstance.shareWholeCollection();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(fixture.componentInstance.shareChoiceOpen()).toBe(false);
      expect(document.body.querySelector('app-sheet')).not.toBeNull();
    });

    // A look-back is computed, so a PUBLIC token needs an album to point at.
    // Sending the family a link must not conjure one: the household link is
    // just the look-back's own URL, and stray albums are litter.
    it('creates no album merely to offer a household link', async () => {
      await fixture.componentInstance.shareWholeCollection();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      http.expectNone('/api/v1/albums');
      // Nothing exists to have links for yet, so nothing is asked about them.
      http.expectNone((request) => request.url.startsWith('/api/v1/sharing/'));
    });

    // THE REGRESSION: the share panel used to copy the household link as it
    // opened, and Android's clipboard toast then covered the very buttons it
    // had opened to offer — including "Create public link".
    it('copies nothing just by opening the share panel', async () => {
      const written: string[] = [];
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: (text: string) => (written.push(text), Promise.resolve()) },
      });

      await fixture.componentInstance.shareWholeCollection();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(written).toEqual([]);
    });

    it('shares a memory moment against the memory itself', async () => {
      fixture.componentRef.setInput('collection', {
        ...LOOKBACK,
        kind: 'memory',
        memoryId: 'memory-3',
      } satisfies SlideshowCollection);
      fixture.detectChanges();

      await fixture.componentInstance.shareWholeCollection();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      http.expectNone('/api/v1/albums');
      http.expectOne('/api/v1/sharing/memory/memory-3').flush({ links: [] });
    });
  });

  describe('the end of the show', () => {
    /** Run to the last slide and past it, which is what finishes the show. */
    function playToTheEnd(): void {
      const overlay = fixture.componentInstance;
      overlay.next();
      overlay.next();
      fixture.detectChanges();
    }

    function endCard(): HTMLElement | null {
      return fixture.nativeElement.querySelector('.end-card');
    }

    it('shows only Replay on the end card', () => {
      playToTheEnd();

      expect(fixture.componentInstance.isFinished()).toBe(true);
      const actions = endCard()?.querySelectorAll('.end-actions button') ?? [];
      expect(Array.from(actions).map((b) => b.textContent?.trim())).toEqual(['↺ Replay']);
    });

    /** Tap the stage at a horizontal position, on a stage fixed at 300px wide. */
    function tapStageAt(clientX: number): void {
      const stage = stageOf(fixture);
      Object.defineProperty(stage, 'clientWidth', { value: 300, configurable: true });
      stage.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX }));
      fixture.detectChanges();
    }

    it('keeps the end card on a middle tap, which still toggles pause as before', () => {
      playToTheEnd();

      tapStageAt(150);
      expect(endCard()).not.toBeNull();
      expect(fixture.componentInstance.isFinished()).toBe(true);
      expect(fixture.componentInstance.isPaused()).toBe(true);

      tapStageAt(150);
      expect(endCard()).not.toBeNull();
      expect(fixture.componentInstance.isPaused()).toBe(false);
    });

    it('keeps the end card on a right-third tap', () => {
      playToTheEnd();

      tapStageAt(290);

      expect(endCard()).not.toBeNull();
      expect(fixture.componentInstance.isFinished()).toBe(true);
    });

    it('steps back on a left-third tap, which removes the end card as navigation', () => {
      playToTheEnd();

      tapStageAt(10);

      expect(fixture.componentInstance.isFinished()).toBe(false);
      expect(endCard()).toBeNull();
    });

    it('replay removes the end card, restarts the show, and the card returns at the end', () => {
      playToTheEnd();
      expect(endCard()).not.toBeNull();

      (endCard()?.querySelector('.replay') as HTMLButtonElement).click();
      fixture.detectChanges();

      expect(endCard()).toBeNull();
      expect(fixture.componentInstance.index()).toBe(0);
      expect(fixture.componentInstance.isFinished()).toBe(false);

      playToTheEnd();

      expect(endCard()).not.toBeNull();
    });
  });

  // THE COMPLAINT: on desktop only the glyph itself answered the click, so
  // skipping a photo meant aiming at a 44px chip. The visible chip is now a
  // child of a much larger button.
  it('puts the arrow glyph in a chip inside the button', () => {
    const next = fixture.nativeElement.querySelector('.nav.next') as HTMLButtonElement;

    const ownText = Array.from(next.childNodes)
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent?.trim())
      .join('');
    expect(ownText).toBe('');
    const chip = next.querySelector('.chip') as HTMLElement;
    expect(chip.textContent?.trim()).toBe('›');
    expect(next.getAttribute('aria-label')).toBe('Next photo');
  });

  describe('photo info', () => {
    const THREE_SLIDES: SlideItem[] = [
      { id: 'asset-1', mediaType: 'image' },
      { id: 'asset-2', mediaType: 'image' },
      { id: 'asset-3', mediaType: 'image' },
    ];
    const HOLD_MS = 3800;

    function overlay(): SlideshowOverlay {
      return fixture.componentInstance;
    }

    function panelOf(): AssetInfoPanel | null {
      return fixture.debugElement.query(By.directive(AssetInfoPanel))?.componentInstance ?? null;
    }

    /** Opens the panel and answers its detail request, as the server would. */
    async function openInfoFor(assetId: string): Promise<void> {
      overlay().openInfo();
      fixture.detectChanges();
      http.expectOne(`/api/v1/assets/${assetId}/detail`).flush({ ...FIXTURE_DETAIL, id: assetId });
      await vi.advanceTimersByTimeAsync(0);
      fixture.detectChanges();
    }

    /**
     * Timers still pending once the framework's own frame callbacks have run -
     * what is left is the slide clock, if it is armed.
     */
    async function pendingSlideTimers(): Promise<number> {
      await vi.advanceTimersByTimeAsync(50);
      return vi.getTimerCount();
    }

    function tick(ms: number): void {
      vi.advanceTimersByTime(ms);
      fixture.detectChanges();
    }

    function press(key: string): KeyboardEvent {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      document.dispatchEvent(event);
      fixture.detectChanges();
      return event;
    }

    beforeEach(() => {
      fixture.componentRef.setInput('allowInfo', true);
      fixture.componentRef.setInput('items', THREE_SLIDES);
      fixture.detectChanges();
      // Re-arm the slide clock under fake timers, so time can be driven.
      overlay().togglePause();
      fixture.detectChanges();
      vi.useFakeTimers();
      overlay().togglePause();
      fixture.detectChanges();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    describe('AC-3: opens the info for the photo on screen', () => {
      it('requests the detail of the current slide, after moving on', async () => {
        overlay().next();
        fixture.detectChanges();

        await openInfoFor('asset-2');

        expect(overlay().infoOpen()).toBe(true);
        expect(panelOf()?.asset().id, 'the panel must show the slide on screen').toBe('asset-2');
      });

      it('shows the panel at once, before the detail has arrived', () => {
        overlay().openInfo();
        fixture.detectChanges();

        expect(panelOf()).not.toBeNull();
        expect(overlay().infoDetailLoading()).toBe(true);
        http.expectOne('/api/v1/assets/asset-1/detail');
      });

      it('keeps the panel usable when the detail cannot be loaded', async () => {
        overlay().openInfo();
        http.expectOne('/api/v1/assets/asset-1/detail').flush('no', { status: 500, statusText: 'Error' });
        await vi.advanceTimersByTimeAsync(0);
        fixture.detectChanges();

        expect(panelOf()).not.toBeNull();
        expect(overlay().infoDetailLoading()).toBe(false);
      });

      it('does nothing when the page has not opted in', () => {
        fixture.componentRef.setInput('allowInfo', false);
        fixture.detectChanges();

        overlay().openInfo();

        expect(overlay().infoOpen()).toBe(false);
        expect(overlay().isPaused()).toBe(false);
      });

      it('does nothing for an anonymous visitor even when the page opted in', () => {
        TestBed.inject(AuthStateService).user.set(null);

        overlay().openInfo();

        expect(overlay().infoOpen()).toBe(false);
        http.expectNone('/api/v1/assets/asset-1/detail');
      });
    });

    describe('AC-4: the same panel as the viewer', () => {
      it('shows the same fact rows as a standalone panel given the same detail', async () => {
        await openInfoFor('asset-1');

        const rowsOf = (root: HTMLElement): string[] =>
          Array.from(root.querySelectorAll('dl > div')).map((row) =>
            (row.textContent ?? '').replace(/\s+/g, ' ').trim(),
          );
        const inShow = rowsOf(fixture.nativeElement.querySelector('app-asset-info-panel'));

        const standalone = TestBed.createComponent(AssetInfoPanel);
        standalone.componentRef.setInput('asset', panelOf()?.asset());
        standalone.componentRef.setInput('detail', { ...FIXTURE_DETAIL, id: 'asset-1' });
        standalone.detectChanges();

        expect(inShow.length, 'the slideshow must render the fact rows').toBeGreaterThan(3);
        expect(inShow).toEqual(rowsOf(standalone.nativeElement));
      });

      it('gives a read-only user no edit or reprocess controls', async () => {
        TestBed.inject(AuthStateService).user.set(userWithPermission('read'));
        fixture.detectChanges();

        await openInfoFor('asset-1');

        const panel = fixture.nativeElement.querySelector('app-asset-info-panel') as HTMLElement;
        const labels = Array.from(panel.querySelectorAll('button')).map((b) => b.textContent?.trim());
        expect(labels.filter((label) => /Edit|Add title|Re-pull|Try again/.test(label ?? ''))).toEqual([]);
      });

      it('offers the edit controls to a user with the write grant', async () => {
        await openInfoFor('asset-1');

        const panel = fixture.nativeElement.querySelector('app-asset-info-panel') as HTMLElement;
        expect(panel.textContent).toContain('Edit date');
      });
    });

    describe('AC-5: the show holds still while info is open', () => {
      it('stays on the same photo however long the panel is open', async () => {
        await openInfoFor('asset-1');

        tick(3 * HOLD_MS);

        expect(overlay().index()).toBe(0);
      });

      it('ignores next, previous, arrows, Space and stage taps', async () => {
        overlay().next();
        fixture.detectChanges();
        await openInfoFor('asset-2');

        overlay().next();
        overlay().previous();
        overlay().togglePause();
        press('ArrowRight');
        press('ArrowLeft');
        const space = press(' ');
        const stage = stageOf(fixture);
        Object.defineProperty(stage, 'clientWidth', { value: 300, configurable: true });
        stage.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 290 }));
        fixture.detectChanges();

        expect(overlay().index()).toBe(1);
        expect(overlay().isPaused()).toBe(true);
        expect(space.defaultPrevented, 'Space must stay free for typing in the panel').toBe(false);
      });

      it('lets a video finish without advancing the show', () => {
        fixture.componentRef.setInput('items', VIDEO_SLIDES);
        fixture.detectChanges();
        overlay().infoOpen.set(true);

        overlay().onVideoEnded();
        overlay().onVideoError();
        tick(5000);

        expect(overlay().index()).toBe(0);
      });
    });

    describe('AC-6: opening info pauses a playing show', () => {
      it('pauses and leaves no timer pending', async () => {
        await openInfoFor('asset-1');
        expect(overlay().isPaused()).toBe(true);
        expect(await pendingSlideTimers(), 'no slide timer may survive opening info').toBe(0);
      });

      it('cannot lose a race with a slide that was about to change', () => {
        tick(HOLD_MS - 1);

        overlay().openInfo();
        tick(10);

        expect(overlay().index()).toBe(0);
        http.expectOne('/api/v1/assets/asset-1/detail');
      });
    });

    describe('AC-7: closing info resumes a show that was playing', () => {
      it('advances after a full hold once the panel is closed', async () => {
        await openInfoFor('asset-1');

        overlay().closeInfo();
        fixture.detectChanges();
        tick(HOLD_MS - 1);
        expect(overlay().index(), 'the hold restarts from zero').toBe(0);
        tick(1);

        expect(overlay().isPaused()).toBe(false);
        expect(overlay().index()).toBe(1);
      });

      it('resumes again on a second open and close', async () => {
        await openInfoFor('asset-1');
        overlay().closeInfo();
        fixture.detectChanges();
        tick(HOLD_MS);
        expect(overlay().index()).toBe(1);

        await openInfoFor('asset-2');
        overlay().closeInfo();
        fixture.detectChanges();
        tick(HOLD_MS);

        expect(overlay().index()).toBe(2);
      });

      it('does not replay a finished show when closed', async () => {
        overlay().next();
        overlay().next();
        overlay().next();
        fixture.detectChanges();
        expect(overlay().isFinished()).toBe(true);

        await openInfoFor('asset-3');
        overlay().closeInfo();
        fixture.detectChanges();
        tick(5 * HOLD_MS);

        expect(overlay().isFinished()).toBe(true);
        expect(overlay().index()).toBe(2);
        expect(await pendingSlideTimers()).toBe(0);
      });
    });

    describe('AC-8: closing info leaves a user-paused show paused', () => {
      it('stays paused with no timer pending', async () => {
        overlay().togglePause();
        fixture.detectChanges();
        expect(await pendingSlideTimers()).toBe(0);

        await openInfoFor('asset-1');
        overlay().closeInfo();
        fixture.detectChanges();
        tick(3 * HOLD_MS);

        expect(overlay().isPaused()).toBe(true);
        expect(overlay().index()).toBe(0);
        expect(await pendingSlideTimers()).toBe(0);
      });

      it('does not carry a resume over from an earlier open to a later one', async () => {
        await openInfoFor('asset-1');
        overlay().closeInfo();
        fixture.detectChanges();
        overlay().togglePause();
        fixture.detectChanges();

        await openInfoFor('asset-1');
        overlay().closeInfo();
        fixture.detectChanges();

        expect(overlay().isPaused()).toBe(true);
      });
    });

    describe('AC-10: modal behaviour and keyboard', () => {
      it('closes only the panel on Escape', async () => {
        const closed = vi.fn();
        overlay().closed.subscribe(closed);
        await openInfoFor('asset-1');

        press('Escape');

        expect(overlay().infoOpen()).toBe(false);
        expect(closed).not.toHaveBeenCalled();
      });

      it('closes the slideshow on Escape when the panel is not open', () => {
        const closed = vi.fn();
        overlay().closed.subscribe(closed);

        press('Escape');

        expect(closed).toHaveBeenCalledTimes(1);
      });

      it('closes the panel from its own Close button', async () => {
        await openInfoFor('asset-1');

        (fixture.nativeElement.querySelector('[aria-label="Close photo details"]') as HTMLElement).click();
        fixture.detectChanges();

        expect(overlay().infoOpen()).toBe(false);
      });

      it('closes the panel on a tap outside it, without steering the show', async () => {
        await openInfoFor('asset-1');

        (fixture.nativeElement.querySelector('.info-scrim') as HTMLElement).click();
        fixture.detectChanges();

        expect(overlay().infoOpen()).toBe(false);
        expect(overlay().index()).toBe(0);
      });

      it('makes the rest of the show inert while open, and live again after', async () => {
        const inertParts = (): number => fixture.nativeElement.querySelectorAll('[inert]').length;
        expect(inertParts()).toBe(0);

        await openInfoFor('asset-1');
        expect(fixture.nativeElement.querySelector('.bar').hasAttribute('inert')).toBe(true);
        expect(fixture.nativeElement.querySelector('.stage').hasAttribute('inert')).toBe(true);
        expect(fixture.nativeElement.querySelector('.playpause').hasAttribute('inert')).toBe(true);

        overlay().closeInfo();
        fixture.detectChanges();
        expect(inertParts()).toBe(0);
      });

      it('moves focus into the panel on open and back out on close', async () => {
        await openInfoFor('asset-1');
        await fixture.whenStable();
        expect(document.activeElement?.closest('app-asset-info-panel')).not.toBeNull();

        overlay().closeInfo();
        fixture.detectChanges();
        await fixture.whenStable();

        expect(document.activeElement?.closest('app-asset-info-panel') ?? null).toBeNull();
      });
    });

    describe('AC-12: nothing changes while info is closed', () => {
      it('still toggles pause with Space', () => {
        const space = press(' ');

        expect(overlay().isPaused()).toBe(true);
        expect(space.defaultPrevented).toBe(true);
      });

      it('still steers with the arrow keys', () => {
        press('ArrowRight');
        expect(overlay().index()).toBe(1);

        press('ArrowLeft');
        expect(overlay().index()).toBe(0);
      });
    });
  });

  afterEach(() => {
    // Defensive: a failure in setup must not be masked by teardown blowing up
    // and leaving the TestBed instantiated for every later case.
    fixture?.destroy();
    http?.verify({ ignoreCancelled: true });
  });
});
