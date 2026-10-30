import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { AssetDetail } from '../../core/api/api-models';
import { AuthStateService } from '../../core/auth/auth-state.service';
import { FIXTURE_ASSET, FIXTURE_DETAIL, userWithPermission } from './asset-detail.fixture';
import { AssetInfoPanel } from './asset-info-panel';

function textOf(fixture: ComponentFixture<AssetInfoPanel>): string {
  return (fixture.nativeElement.textContent as string).replace(/\s+/g, ' ').trim();
}

/** The label/value pairs of the facts list, e.g. { Camera: 'Fuji X100V' }. */
function factRows(fixture: ComponentFixture<AssetInfoPanel>): Record<string, string> {
  const rows: Record<string, string> = {};
  fixture.nativeElement.querySelectorAll('dl > div').forEach((row: HTMLElement) => {
    const label = row.querySelector('dt')?.textContent ?? '';
    rows[label.trim()] = (row.querySelector('dd')?.textContent ?? '').replace(/\s+/g, ' ').trim();
  });
  return rows;
}

function buttonLabels(fixture: ComponentFixture<AssetInfoPanel>): string[] {
  const buttons = Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLElement[];
  return buttons.map((button) => (button.textContent ?? '').replace(/\s+/g, ' ').trim());
}

describe('AssetInfoPanel', () => {
  let fixture: ComponentFixture<AssetInfoPanel>;
  let http: HttpTestingController;

  function createPanel(permission: 'read' | 'write' | 'delete' | null, detail: AssetDetail | null = FIXTURE_DETAIL): void {
    TestBed.inject(AuthStateService).user.set(permission ? userWithPermission(permission) : null);
    fixture = TestBed.createComponent(AssetInfoPanel);
    fixture.componentRef.setInput('asset', FIXTURE_ASSET);
    fixture.componentRef.setInput('detail', detail);
    fixture.componentRef.setInput('title', detail?.title ?? null);
    fixture.detectChanges();
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [AssetInfoPanel],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    vi.useRealTimers();
    http.verify();
  });

  describe('AC-4: shows the same fields and values as everywhere else', () => {
    it('renders title, date, camera, dimensions, file and location from the detail', () => {
      createPanel('read');

      expect(textOf(fixture)).toContain('Summit at dawn');
      expect(factRows(fixture)).toEqual({
        'Date taken': expect.stringContaining('from the camera'),
        'Taken by': 'Alex',
        Camera: 'Fuji X100V',
        Dimensions: '4000 × 3000 · 3.0 MB',
        File: 'trips/acadia/summit.jpg',
        Location: '44.3386, -68.2733 ↗',
      });
    });

    it('links the file to its folder and the location to a map', () => {
      createPanel('read');

      const links = Array.from(fixture.nativeElement.querySelectorAll('a')) as HTMLAnchorElement[];
      const hrefs = links.map((link) => link.getAttribute('href'));
      expect(hrefs).toContain('/people/person-1');
      expect(hrefs).toContain('/folders?root=root-1&path=trips%2Facadia');
      expect(hrefs).toContain('https://www.google.com/maps?q=44.3386,-68.2733');
    });

    it('shows the loading indicator while the detail has not arrived', () => {
      TestBed.inject(AuthStateService).user.set(userWithPermission('read'));
      fixture = TestBed.createComponent(AssetInfoPanel);
      fixture.componentRef.setInput('asset', FIXTURE_ASSET);
      fixture.componentRef.setInput('detailLoading', true);
      fixture.detectChanges();

      expect(textOf(fixture)).toContain('Loading details…');
    });

    it('still names the date from the asset when the detail could not load', () => {
      createPanel('read', null);

      expect(textOf(fixture)).not.toContain('Loading details…');
      expect(fixture.nativeElement.querySelector('.date-header h3')).not.toBeNull();
    });

    it('warns about a processing problem with the failing stage named', () => {
      createPanel('read', { ...FIXTURE_DETAIL, stageErrors: { thumbnail: 'bad file' } });

      expect(fixture.nativeElement.querySelector('.problem')?.textContent).toContain('thumbnail: bad file');
    });
  });

  describe('AC-3: read-only users cannot change anything', () => {
    it('shows no edit, add-title, re-pull or try-again controls to a read-only user', () => {
      createPanel('read', { ...FIXTURE_DETAIL, title: null });

      const labels = buttonLabels(fixture).join('|');
      expect(labels, 'a read-only user must see no editing controls').not.toMatch(
        /Edit|Add title|Re-pull|Try again/,
      );
      expect(fixture.nativeElement.querySelectorAll('button').length).toBe(0);
    });

    it('does not show reprocess on a failing item to a read-only user', () => {
      createPanel('read', { ...FIXTURE_DETAIL, stageErrors: { thumbnail: 'bad file' } });

      expect(buttonLabels(fixture)).not.toContain('Try again');
    });

    it('offers edit controls to a user with the write grant', () => {
      createPanel('write');

      const labels = buttonLabels(fixture);
      expect(labels).toContain('Edit');
      expect(labels).toContain('Edit date');
      expect(labels).toContain('Re-pull date & metadata');
    });
  });

  describe('Close button', () => {
    it('is absent unless the host asks for it', () => {
      createPanel('read');

      expect(fixture.nativeElement.querySelector('[aria-label="Close photo details"]')).toBeNull();
    });

    it('emits closed when the host asked for it and it is pressed', () => {
      createPanel('read');
      fixture.componentRef.setInput('isClosable', true);
      fixture.detectChanges();
      const closed = vi.fn();
      fixture.componentInstance.closed.subscribe(closed);

      (fixture.nativeElement.querySelector('[aria-label="Close photo details"]') as HTMLElement).click();

      expect(closed).toHaveBeenCalledTimes(1);
    });
  });

  describe('editing the title', () => {
    it('saves the trimmed title, shows it, and tells the host', async () => {
      createPanel('write');
      const changed = vi.fn();
      fixture.componentInstance.titleChanged.subscribe(changed);
      fixture.componentInstance.startEditTitle();
      fixture.componentInstance.titleDraft = '  New name  ';

      const saving = fixture.componentInstance.saveTitle();
      const request = http.expectOne('/api/v1/assets/asset-1/title');
      expect(request.request.method).toBe('PATCH');
      expect(request.request.body).toEqual({ title: 'New name' });
      request.flush(null);
      await saving;
      fixture.detectChanges();

      expect(changed).toHaveBeenCalledWith('New name');
      expect(fixture.componentInstance.editingTitle()).toBe(false);
      expect(textOf(fixture)).toContain('New name');
    });

    it('clears the title when saved empty', async () => {
      createPanel('write');
      const changed = vi.fn();
      fixture.componentInstance.titleChanged.subscribe(changed);
      fixture.componentInstance.startEditTitle();
      fixture.componentInstance.titleDraft = '   ';

      const saving = fixture.componentInstance.saveTitle();
      http.expectOne('/api/v1/assets/asset-1/title').flush(null);
      await saving;

      expect(changed).toHaveBeenCalledWith(null);
      expect(fixture.componentInstance.displayTitle()).toBeNull();
    });

    it('stays in edit mode and does not report a change when the save fails', async () => {
      createPanel('write');
      const changed = vi.fn();
      fixture.componentInstance.titleChanged.subscribe(changed);
      fixture.componentInstance.startEditTitle();

      const saving = fixture.componentInstance.saveTitle();
      http.expectOne('/api/v1/assets/asset-1/title').flush('no', { status: 500, statusText: 'Error' });
      await saving;

      expect(changed).not.toHaveBeenCalled();
      expect(fixture.componentInstance.editingTitle()).toBe(true);
    });
  });

  describe('editing the capture date', () => {
    it('saves the date with its offset and tells the host', async () => {
      createPanel('write');
      const changed = vi.fn();
      fixture.componentInstance.capturedAtChanged.subscribe(changed);
      fixture.componentInstance.startEditDate();
      fixture.componentInstance.dateDraft = '2020-01-02T03:04';
      const expected = new Date('2020-01-02T03:04');

      const saving = fixture.componentInstance.saveDate();
      const request = http.expectOne('/api/v1/assets/asset-1/captured-at');
      expect(request.request.body).toEqual({
        capturedAt: expected.toISOString(),
        tzOffsetMin: -expected.getTimezoneOffset(),
      });
      request.flush(null);
      await saving;

      expect(changed).toHaveBeenCalledWith(expected.toISOString());
      expect(fixture.componentInstance.editingDate()).toBe(false);
    });

    it('starts the editor from the loaded detail date when the asset has none', () => {
      createPanel('write');
      fixture.componentRef.setInput('asset', { ...FIXTURE_ASSET, capturedAt: '' });
      fixture.detectChanges();

      fixture.componentInstance.startEditDate();

      const expected = new Date(FIXTURE_DETAIL.capturedAt);
      const pad = (value: number): string => String(value).padStart(2, '0');
      expect(fixture.componentInstance.dateDraft).toBe(
        `${expected.getFullYear()}-${pad(expected.getMonth() + 1)}-${pad(expected.getDate())}T${pad(expected.getHours())}:${pad(expected.getMinutes())}`,
      );
    });

    it('refuses an unparseable date without calling the server', async () => {
      createPanel('write');
      fixture.componentInstance.startEditDate();
      fixture.componentInstance.dateDraft = 'not a date';

      await fixture.componentInstance.saveDate();

      http.expectNone('/api/v1/assets/asset-1/captured-at');
      expect(fixture.componentInstance.editingDate()).toBe(true);
    });
  });

  describe('reprocessing', () => {
    it('queues the job, watches the detail, and finishes when it is healthy', async () => {
      vi.useFakeTimers();
      createPanel('write', { ...FIXTURE_DETAIL, stageErrors: { thumbnail: 'bad file' } });
      const fresh = vi.fn();
      fixture.componentInstance.reprocessed.subscribe(fresh);

      const queued = fixture.componentInstance.reprocess();
      http.expectOne('/api/v1/assets/asset-1/reprocess').flush(null);
      await queued;
      expect(fixture.componentInstance.reprocessState()).toBe('running');

      await vi.advanceTimersByTimeAsync(3000);
      http.expectOne('/api/v1/assets/asset-1/detail').flush(FIXTURE_DETAIL);
      await vi.advanceTimersByTimeAsync(0);

      expect(fresh).toHaveBeenCalledWith(FIXTURE_DETAIL);
      expect(fixture.componentInstance.reprocessState()).toBe('done');
    });

    it('goes back to idle after a minute without a healthy result', async () => {
      vi.useFakeTimers();
      createPanel('write', { ...FIXTURE_DETAIL, stageErrors: { thumbnail: 'bad file' } });

      const queued = fixture.componentInstance.reprocess();
      http.expectOne('/api/v1/assets/asset-1/reprocess').flush(null);
      await queued;

      for (let elapsed = 0; elapsed <= 63_000; elapsed += 3000) {
        await vi.advanceTimersByTimeAsync(3000);
        http.match('/api/v1/assets/asset-1/detail').forEach((request) =>
          request.flush({ ...FIXTURE_DETAIL, stageErrors: { thumbnail: 'bad file' } }),
        );
      }

      expect(fixture.componentInstance.reprocessState()).toBe('idle');
    });

    it('returns to idle when the job cannot be queued', async () => {
      createPanel('write');

      const queued = fixture.componentInstance.reprocess();
      http.expectOne('/api/v1/assets/asset-1/reprocess').flush('no', { status: 500, statusText: 'Error' });
      await queued;

      expect(fixture.componentInstance.reprocessState()).toBe('idle');
    });
  });

  describe('moving to another photo', () => {
    it('drops edit mode and any saved edits of the previous photo', async () => {
      createPanel('write');
      fixture.componentInstance.startEditTitle();
      fixture.componentInstance.startEditDate();

      fixture.componentRef.setInput('asset', { ...FIXTURE_ASSET, id: 'asset-2' });
      fixture.detectChanges();

      expect(fixture.componentInstance.editingTitle()).toBe(false);
      expect(fixture.componentInstance.editingDate()).toBe(false);
      expect(fixture.componentInstance.reprocessState()).toBe('idle');
    });
  });
});
