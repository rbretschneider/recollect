import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AuthStateService } from '../../core/auth/auth-state.service';
import { SlideItem, SlideshowCollection, SlideshowOverlay } from './slideshow-overlay';

/**
 * Regression cover for the slideshow overlay.
 *
 * Both cases here shipped broken: the un-zoom that crawled for six seconds,
 * and "share the whole look-back" that did nothing at all.
 */

const SLIDES: SlideItem[] = [
  { id: 'asset-1', mediaType: 'image' },
  { id: 'asset-2', mediaType: 'image' },
];

const LOOKBACK: SlideshowCollection = {
  title: 'Acadia, 2021',
  kind: 'place',
  memoryId: null,
  assetIds: ['asset-1', 'asset-2'],
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
      providers: [provideHttpClient(), provideHttpClientTesting()],
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

  describe('sharing the whole collection', () => {
    // THE REGRESSION: this share button is rendered only once its target is
    // set, and the old code awaited a single microtask before reaching for the
    // viewChild. When it was not there yet, `?.open()` silently did nothing.
    it('opens the share panel once the lazily-rendered button exists', async () => {
      fixture.componentInstance.openShareChoice();
      fixture.detectChanges();

      const shared = fixture.componentInstance.shareWholeCollection();

      // A place moment has to be materialised as an album first.
      const create = http.expectOne('/api/v1/albums');
      expect(create.request.method).toBe('POST');
      create.flush({ albumId: 'album-9' });
      await shared;
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      // The panel asks for the target's existing links as it opens — proof it
      // really opened rather than quietly doing nothing.
      const links = http.expectOne('/api/v1/sharing/album/album-9');
      expect(links.request.method).toBe('GET');
      links.flush({ links: [] });
      fixture.detectChanges();

      expect(fixture.componentInstance.shareChoiceOpen()).toBe(false);
      expect(document.body.querySelector('app-sheet')).not.toBeNull();
    });

    it('shares a memory moment directly, without creating an album', async () => {
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

  afterEach(() => {
    // Defensive: a failure in setup must not be masked by teardown blowing up
    // and leaving the TestBed instantiated for every later case.
    fixture?.destroy();
    http?.verify({ ignoreCancelled: true });
  });
});
