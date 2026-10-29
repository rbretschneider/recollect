import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthStateService } from '../../core/auth/auth-state.service';
import { FIXTURE_ASSET, FIXTURE_DETAIL, userWithPermission } from './asset-detail.fixture';
import { AssetInfoPanel } from './asset-info-panel';
import { AssetViewer } from './asset-viewer';

/** The label/value pairs of the facts list inside a root element. */
function factRows(root: HTMLElement): Record<string, string> {
  const rows: Record<string, string> = {};
  root.querySelectorAll('dl > div').forEach((row) => {
    const label = row.querySelector('dt')?.textContent ?? '';
    rows[label.trim()] = (row.querySelector('dd')?.textContent ?? '').replace(/\s+/g, ' ').trim();
  });
  return rows;
}

describe('AssetViewer', () => {
  let fixture: ComponentFixture<AssetViewer>;
  let http: HttpTestingController;

  async function settle(): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function openViewer(permission: 'read' | 'write' | 'delete'): void {
    TestBed.inject(AuthStateService).user.set(userWithPermission(permission));
    fixture = TestBed.createComponent(AssetViewer);
    fixture.componentRef.setInput('assets', [FIXTURE_ASSET]);
    fixture.componentRef.setInput('startIndex', 0);
    fixture.detectChanges();
    flushDetailRequests();
  }

  /** Opening the panel re-requests the detail, so answer however many are pending. */
  function flushDetailRequests(): void {
    http.match('/api/v1/assets/asset-1/detail').forEach((request) => request.flush(FIXTURE_DETAIL));
  }

  async function openPanel(): Promise<AssetInfoPanel> {
    infoButton().click();
    flushDetailRequests();
    await settle();
    return fixture.debugElement.query((node) => node.name === 'app-asset-info-panel')
      .componentInstance as AssetInfoPanel;
  }

  function infoButton(): HTMLButtonElement {
    return fixture.nativeElement.querySelector('[aria-label="Photo details"].icon') as HTMLButtonElement;
  }

  beforeEach(() => {
    // jsdom does not implement scrolling; the viewer restores scroll on close.
    window.scrollTo = () => undefined;
    TestBed.configureTestingModule({
      imports: [AssetViewer],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    fixture.destroy();
    http.verify();
  });

  describe('AC-4: the details panel matches the shared panel', () => {
    it('shows the same fact rows as a standalone panel given the same detail', async () => {
      openViewer('read');
      await settle();
      await openPanel();

      const standalone = TestBed.createComponent(AssetInfoPanel);
      standalone.componentRef.setInput('asset', FIXTURE_ASSET);
      standalone.componentRef.setInput('detail', FIXTURE_DETAIL);
      standalone.componentRef.setInput('title', FIXTURE_DETAIL.title);
      standalone.detectChanges();

      const inViewer = factRows(fixture.nativeElement.querySelector('app-asset-info-panel'));
      expect(Object.keys(inViewer).length, 'the viewer must render the fact rows').toBeGreaterThan(3);
      expect(inViewer).toEqual(factRows(standalone.nativeElement));
    });

    it('does not offer a Close button inside the viewer, which has its own', async () => {
      openViewer('read');
      await openPanel();

      expect(fixture.nativeElement.querySelector('[aria-label="Close photo details"]')).toBeNull();
    });

    it('opens and closes the panel with the info toggle', async () => {
      openViewer('read');
      expect(fixture.nativeElement.querySelector('app-asset-info-panel')).toBeNull();

      await openPanel();
      expect(fixture.nativeElement.querySelector('app-asset-info-panel')).not.toBeNull();

      infoButton().click();
      await settle();
      expect(fixture.nativeElement.querySelector('app-asset-info-panel')).toBeNull();
    });
  });

  describe('edits made in the panel reach the viewer', () => {
    it('updates the caption band after a title is saved', async () => {
      openViewer('write');
      const panel = await openPanel();

      panel.startEditTitle();
      panel.titleDraft = 'Renamed';
      const saving = panel.saveTitle();
      http.expectOne('/api/v1/assets/asset-1/title').flush(null);
      await saving;

      expect(fixture.componentInstance.displayTitle()).toBe('Renamed');
    });

    it('takes fresh detail from the panel while a reprocess is watched', async () => {
      openViewer('write');
      const panel = await openPanel();
      const refreshed = { ...FIXTURE_DETAIL, title: 'After reprocess' };

      panel.reprocessed.emit(refreshed);

      expect(fixture.componentInstance.detail()).toEqual(refreshed);
    });
  });
});
