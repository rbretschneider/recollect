import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ShareButton } from './share-button';

/**
 * Cover for the two ways to share.
 *
 * The household link is the common one — a family member already has an
 * account, so the link is just an app URL behind the auth guard. It costs no
 * server round trip, mints no token and leaves nothing to revoke, and it must
 * never create anything.
 *
 * THE RULE, and the regression these guard: nothing in this panel touches the
 * clipboard unless someone taps Copy. Opening the sheet and creating a link
 * both used to copy on your behalf, and Android answers every clipboard write
 * with a system toast pinned to the bottom of the screen — which sat right on
 * top of "Create public link" and the text explaining what it would do.
 */
describe('ShareButton', () => {
  let fixture: ComponentFixture<ShareButton>;
  let http: HttpTestingController;
  let written: string[];

  beforeEach(async () => {
    written = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: (text: string) => (written.push(text), Promise.resolve()) },
    });

    await TestBed.configureTestingModule({
      imports: [ShareButton],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(ShareButton);
  });

  afterEach(() => {
    fixture?.destroy();
    http?.verify({ ignoreCancelled: true });
  });

  /** Lets the create chain (which may resolve a target first) reach the wire. */
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  function open(inputs: Record<string, unknown>) {
    for (const [key, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(key, value);
    }
    fixture.detectChanges();
    return fixture.componentInstance.open();
  }

  describe('the household link', () => {
    // THE REGRESSION: opening the sheet copied for you, and Android's toast
    // then covered the controls the sheet had just opened to offer.
    it('is not copied merely by opening the sheet', async () => {
      const opened = open({ targetType: 'memory', targetId: 'memory-1' });
      http.expectOne('/api/v1/sharing/memory/memory-1').flush({ links: [] });
      await opened;

      expect(written).toEqual([]);
      expect(fixture.componentInstance.internalCopied()).toBeNull();
      // It is on screen, ready for the Copy button next to it.
      expect(fixture.componentInstance.internalUrl()).toBe(
        `${location.origin}/memories/memory-1`,
      );
    });

    it('is the memory’s own page when Copy is tapped', async () => {
      const opened = open({ targetType: 'memory', targetId: 'memory-1' });
      http.expectOne('/api/v1/sharing/memory/memory-1').flush({ links: [] });
      await opened;
      await fixture.componentInstance.copyInternal();

      expect(written).toEqual([`${location.origin}/memories/memory-1`]);
      expect(fixture.componentInstance.internalCopied()).toBe('copied');
    });

    it('is the album’s own page', async () => {
      const opened = open({ targetType: 'album', targetId: 'album-1' });
      http.expectOne('/api/v1/sharing/album/album-1').flush({ links: [] });
      await opened;
      await fixture.componentInstance.copyInternal();

      expect(written).toEqual([`${location.origin}/albums/album-1`]);
    });

    // Photos have no page of their own; the grid opens them on a query param.
    it('is a deep link into the grid for a single photo', async () => {
      const opened = open({ targetType: 'asset', targetId: 'asset-1' });
      http.expectOne('/api/v1/sharing/asset/asset-1').flush({ links: [] });
      await opened;
      await fixture.componentInstance.copyInternal();

      expect(written).toEqual([`${location.origin}/photos?asset=asset-1`]);
    });

    it('takes an explicit path for things with no row of their own', async () => {
      const opened = open({
        targetType: 'album',
        targetId: '',
        internalPath: '/lookback?day=09-25&year=2021',
      });
      await opened;
      await fixture.componentInstance.copyInternal();

      expect(written).toEqual([`${location.origin}/lookback?day=09-25&year=2021`]);
    });

    it('says so rather than failing silently when the clipboard refuses', async () => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: () => Promise.reject(new Error('denied')) },
      });

      const opened = open({ targetType: 'memory', targetId: 'memory-1' });
      http.expectOne('/api/v1/sharing/memory/memory-1').flush({ links: [] });
      await opened;
      await fixture.componentInstance.copyInternal();

      expect(fixture.componentInstance.internalCopied()).toBe('failed');
      // The sheet is still open with the URL on screen to copy by hand.
      expect(fixture.componentInstance.isOpen()).toBe(true);
    });
  });

  describe('the public link', () => {
    // THE GUARANTEE: a look-back has no row, so a token needs an album — but
    // only when someone actually chooses to expose it.
    it('materialises a lazy target only when a link is created', async () => {
      let resolved = 0;
      const opened = open({
        targetType: 'album',
        targetId: '',
        internalPath: '/lookback?day=09-25&year=2021',
        resolveTarget: () => {
          resolved++;
          return Promise.resolve('album-9');
        },
      });
      await opened;

      // Opening the sheet asked for nothing at all.
      expect(resolved).toBe(0);
      http.expectNone((request) => request.url.startsWith('/api/v1/sharing/'));

      const creating = fixture.componentInstance.createLink();
      await flush();
      const create = http.expectOne('/api/v1/sharing');
      expect(create.request.body.targetId).toBe('album-9');
      create.flush({ link: { id: 'link-1', token: 'tok', expiresAt: null, viewCount: 0 } });
      await creating;

      expect(resolved).toBe(1);
    });

    // THE REGRESSION: this copied the new link for you, so Android's toast
    // landed on the row that had just appeared with the link in it.
    it('shows a newly created link without copying it', async () => {
      const opened = open({ targetType: 'memory', targetId: 'memory-1' });
      http.expectOne('/api/v1/sharing/memory/memory-1').flush({ links: [] });
      await opened;

      const creating = fixture.componentInstance.createLink();
      await flush();
      http
        .expectOne('/api/v1/sharing')
        .flush({ link: { id: 'link-1', token: 'tok', expiresAt: null, viewCount: 0 } });
      await creating;

      expect(written).toEqual([]);
      expect(fixture.componentInstance.links().map((link) => link.id)).toEqual(['link-1']);
    });

    it('copies a public link when its Copy button is tapped', async () => {
      const opened = open({ targetType: 'memory', targetId: 'memory-1' });
      http
        .expectOne('/api/v1/sharing/memory/memory-1')
        .flush({ links: [{ id: 'link-1', token: 'tok', expiresAt: null, viewCount: 0 }] });
      await opened;

      await fixture.componentInstance.copy(fixture.componentInstance.links()[0]);

      expect(written).toEqual([`${location.origin}/s/tok`]);
    });

    it('does not copy when the expiry is changed', async () => {
      const opened = open({ targetType: 'memory', targetId: 'memory-1' });
      http
        .expectOne('/api/v1/sharing/memory/memory-1')
        .flush({ links: [{ id: 'link-1', token: 'tok', expiresAt: null, viewCount: 0 }] });
      await opened;

      const extending = fixture.componentInstance.extend(fixture.componentInstance.links()[0]);
      const update = http.expectOne('/api/v1/sharing/link-1');
      update.flush({ link: { id: 'link-1', token: 'tok', expiresAt: null, viewCount: 0 } });
      await extending;

      expect(written).toEqual([]);
    });
  });
});
