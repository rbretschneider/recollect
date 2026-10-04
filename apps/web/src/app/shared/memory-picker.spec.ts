import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MemoryPick, MemoryPicker } from './memory-picker';

/**
 * Cover for filing photos into a memory.
 *
 * The subtle part is creating one. A memory takes its date span from its
 * contents, so it is created *around* the photos in a single call rather than
 * made empty and filled afterwards — which means the caller must not then
 * attach them a second time. `alreadyAdded` is what tells it apart, and it is
 * the kind of thing that silently double-writes if it regresses.
 */
describe('MemoryPicker', () => {
  let fixture: ComponentFixture<MemoryPicker>;
  let http: HttpTestingController;
  let picks: MemoryPick[];

  const MEMORIES = [
    {
      id: 'memory-1',
      title: 'Beach day',
      startAt: '2025-07-04T10:00:00.000Z',
      endAt: '2025-07-04T18:00:00.000Z',
      coverAssetId: null,
      assetCount: 12,
      journalPreview: null,
      locationLabel: null,
    },
  ];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MemoryPicker],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(MemoryPicker);
    picks = [];
    fixture.componentRef.setInput('assetIds', ['asset-1', 'asset-2']);
    fixture.componentInstance.picked.subscribe((pick) => picks.push(pick));
    fixture.detectChanges();
    http.expectOne('/api/v1/memories').flush({ memories: MEMORIES });
  });

  afterEach(() => {
    fixture?.destroy();
    http?.verify({ ignoreCancelled: true });
  });

  it('reports an existing memory as still needing its photos attached', () => {
    fixture.componentInstance.choose('memory-1');

    expect(picks).toEqual([{ memoryId: 'memory-1', alreadyAdded: false }]);
  });

  // THE REGRESSION: creating a memory already files the photos. A caller that
  // attached them again would write every photo twice.
  it('creates a new memory around the photos and says they are already in', async () => {
    fixture.componentInstance.filterText.set('Camping trip');
    const created = fixture.componentInstance.createAndChoose();

    const request = http.expectOne('/api/v1/memories');
    expect(request.request.body).toEqual({
      title: 'Camping trip',
      assetIds: ['asset-1', 'asset-2'],
    });
    request.flush({ memoryId: 'memory-2' });
    await created;

    expect(picks).toEqual([{ memoryId: 'memory-2', alreadyAdded: true }]);
  });

  it('offers creation only for a name that is not already a memory', () => {
    fixture.componentInstance.filterText.set('Beach day');
    expect(fixture.componentInstance.canCreate()).toBe(false);

    // Case and surrounding space are not what makes a memory distinct.
    fixture.componentInstance.filterText.set('  beach DAY  ');
    expect(fixture.componentInstance.canCreate()).toBe(false);

    fixture.componentInstance.filterText.set('Beach day two');
    expect(fixture.componentInstance.canCreate()).toBe(true);
  });

  it('filters the list as you type, ignoring case', () => {
    fixture.componentInstance.filterText.set('BEACH');
    expect(fixture.componentInstance.filtered().map((memory) => memory.id)).toEqual(['memory-1']);

    fixture.componentInstance.filterText.set('mountains');
    expect(fixture.componentInstance.filtered()).toEqual([]);
  });
});
