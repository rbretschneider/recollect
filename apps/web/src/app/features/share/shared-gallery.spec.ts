import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { SharedView } from '../../core/api/api-models';
import { SharedViewPage } from './shared-view-page';

/**
 * Cover for what a share link actually shows.
 *
 * The public page was written as an essay: journal paragraphs with captioned
 * photos woven between them, and anything left over parked in a polaroid stack
 * at the end. An album has no journal and no captions, so every section
 * collapsed and ALL of its photos fell into that "leftovers" stack — fifty
 * photos behind a single thumbnail you had to tap. The same thing happened to
 * any memory shared before its journal was written.
 *
 * The page now decides on what the link contains rather than on what it points
 * at: no story, no essay — show the photographs.
 */
describe('a shared link without a story shows its photos', () => {
  let fixture: ComponentFixture<SharedViewPage>;
  let page: SharedViewPage;

  function viewOf(partial: Partial<SharedView>): SharedView {
    return {
      targetType: 'album',
      title: 'Hollis, New Hampshire, United States, 2025',
      description: null,
      startAt: '2025-10-03T12:00:00.000Z',
      endAt: '2025-10-04T12:00:00.000Z',
      assetIds: ['a1', 'a2', 'a3'],
      captions: {},
      journal: [],
      quotes: [],
      people: [],
      mediaItems: [],
      sharedFrom: 'Shared from The Bretschneiders',
      ...partial,
    } as SharedView;
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SharedViewPage],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(SharedViewPage);
    page = fixture.componentInstance;
  });

  afterEach(() => fixture?.destroy());

  // THE REGRESSION: an album share had no story, so every photo became a
  // "leftover" and the page rendered one tappable stack instead of a gallery.
  it('reads an album share as a gallery, not an essay', () => {
    page.view.set(viewOf({ targetType: 'album' }));

    expect(page.isGallery()).toBe(true);
  });

  it('reads a memory shared before its journal was written as a gallery too', () => {
    page.view.set(viewOf({ targetType: 'memory', journal: [], captions: {} }));

    expect(page.isGallery()).toBe(true);
  });

  it('keeps the essay once there is something to read', () => {
    page.view.set(
      viewOf({
        targetType: 'memory',
        journal: [
          { authorName: 'Ryan', bodyMd: 'We traveled to NH for the annual duck race.' },
        ],
      }),
    );

    expect(page.isGallery()).toBe(false);
  });

  // Captions alone are a story: they are the words under the photographs.
  it('keeps the essay when photos are captioned but nothing is written', () => {
    page.view.set(viewOf({ captions: { a1: 'the rocks were sweet' } }));

    expect(page.isGallery()).toBe(false);
  });

  it('opens the gallery on its first photo', () => {
    page.view.set(viewOf({ assetIds: ['first', 'second'] }));

    expect(page.heroAssetId()).toBe('first');
  });

  it('has no hero to show for an empty share', () => {
    page.view.set(viewOf({ assetIds: [] }));

    expect(page.heroAssetId()).toBeNull();
  });
});
