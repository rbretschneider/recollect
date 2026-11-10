import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthStateService } from '../../core/auth/auth-state.service';
import { PhotosPage } from './photos-page';

/** Cover for downloading a selection from the All Photos page. */
describe('PhotosPage download', () => {
  let fixture: ComponentFixture<PhotosPage>;
  let page: PhotosPage;

  function signInWith(permission: 'read' | 'write' | 'delete'): void {
    const auth = TestBed.inject(AuthStateService);
    (auth.user as unknown as { set: (value: unknown) => void }).set({
      id: 'user-1',
      displayName: 'Ryan',
      permission,
      isAdmin: false,
    });
  }

  function select(ids: string[]): void {
    page.startSelecting();
    page.selectedIds.set(new Set(ids));
    fixture.detectChanges();
  }

  function buttonLabels(): string[] {
    return Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('app-selection-bar button'),
    ).map((button) => button.textContent?.trim() ?? '');
  }

  beforeEach(async () => {
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      },
    );
    await TestBed.configureTestingModule({
      imports: [PhotosPage],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();
    fixture = TestBed.createComponent(PhotosPage);
    page = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fixture?.destroy();
    document.querySelectorAll('form').forEach((form) => form.remove());
  });

  it('offers Download to a read-only user, without the editing actions', () => {
    signInWith('read');
    select(['a']);
    expect(buttonLabels()).toEqual(['Download']);
  });

  it('downloads a single photo through the per-asset endpoint and leaves select mode', () => {
    signInWith('write');
    const clicked: string[] = [];
    const original = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      clicked.push(this.getAttribute('href') ?? '');
    };
    try {
      select(['asset-1']);
      page.downloadSelected();
    } finally {
      HTMLAnchorElement.prototype.click = original;
    }
    expect(clicked).toEqual(['/api/v1/assets/asset-1/download']);
    expect(page.isSelecting()).toBe(false);
    expect(page.selectedIds().size).toBe(0);
  });

  it('posts several photos as one ZIP request and clears the selection', () => {
    signInWith('write');
    const posted: { action: string; ids: string }[] = [];
    const original = HTMLFormElement.prototype.submit;
    HTMLFormElement.prototype.submit = function (this: HTMLFormElement) {
      posted.push({
        action: this.getAttribute('action') ?? '',
        ids: (this.elements.namedItem('assetIds') as HTMLInputElement).value,
      });
    };
    try {
      select(['a', 'b', 'c']);
      page.downloadSelected();
    } finally {
      HTMLFormElement.prototype.submit = original;
    }
    expect(posted).toEqual([{ action: '/api/v1/assets/download.zip', ids: 'a,b,c' }]);
    expect(page.isSelecting()).toBe(false);
    expect(page.selectedIds().size).toBe(0);
  });

  it('disables Download above the server cap', () => {
    signInWith('write');
    select(Array.from({ length: page.maxDownload + 1 }, (_, i) => `id-${i}`));
    const button = (fixture.nativeElement as HTMLElement).querySelector(
      'app-selection-bar button',
    ) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });
});
