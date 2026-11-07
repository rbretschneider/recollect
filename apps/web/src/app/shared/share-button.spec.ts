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
 * THE RULE: opening the sheet never touches the clipboard, and the household
 * link is copied only by its own Copy tap (Android answers every clipboard
 * write with a system toast pinned to the bottom of the screen). Creating a
 * public link, or updating its expiration, copies that link's URL — taken from
 * the server's response — and a refused clipboard never undoes the change.
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
    delete (globalThis as unknown as { ClipboardItem?: unknown }).ClipboardItem;
    fixture?.destroy();
    http?.verify({ ignoreCancelled: true });
  });

  interface FakeItem {
    data: Record<string, Promise<Blob>>;
  }

  /** Installs a ClipboardItem-capable clipboard whose write is `write`. */
  function installClipboardItem(
    write: (items: ClipboardItem[]) => Promise<void>,
    writeText: (text: string) => Promise<void> = (text) => (written.push(text), Promise.resolve()),
  ) {
    class Item {
      constructor(public data: Record<string, Promise<Blob>>) {}
    }
    (globalThis as unknown as { ClipboardItem: unknown }).ClipboardItem = Item;
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { write, writeText } });
  }

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

    const link = (id: string, token: string, expiresAt: string | null = null) => ({
      id,
      token,
      expiresAt,
      viewCount: 0,
    });

    async function openMemory(links: unknown[] = []) {
      const opened = open({ targetType: 'memory', targetId: 'memory-1' });
      http.expectOne('/api/v1/sharing/memory/memory-1').flush({ links });
      await opened;
    }

    it('copies the created link, using the token from the response', async () => {
      await openMemory([link('other', 'listed')]);

      const creating = fixture.componentInstance.createLink();
      await flush();
      http.expectOne('/api/v1/sharing').flush({ link: link('link-1', 'fresh') });
      await creating;
      await flush();

      expect(written).toEqual([`${location.origin}/s/fresh`]);
      expect(fixture.componentInstance.links().map((l) => l.id)).toEqual(['link-1', 'other']);
      expect(fixture.componentInstance.copiedLinkId()).toBe('link-1');
    });

    it('starts the clipboard write inside the tap, before the response arrives', async () => {
      let resolveBlob: Promise<Blob> | undefined;
      const writes: number[] = [];
      installClipboardItem((items) => {
        writes.push(1);
        resolveBlob = (items[0] as unknown as FakeItem).data['text/plain'];
        return Promise.resolve();
      });
      await openMemory();

      const creating = fixture.componentInstance.createLink();
      expect(writes.length).toBe(1);
      await flush();
      http.expectOne('/api/v1/sharing').flush({ link: link('link-1', 'fresh') });
      await creating;
      await flush();

      expect(await (await resolveBlob!).text()).toBe(`${location.origin}/s/fresh`);
      expect(writes.length).toBe(1);
      expect(written).toEqual([]);
    });

    it('does not claim success until the browser confirms the write', async () => {
      let confirm!: () => void;
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: () => new Promise<void>((resolve) => (confirm = resolve)) },
      });
      await openMemory();

      const creating = fixture.componentInstance.createLink();
      await flush();
      http.expectOne('/api/v1/sharing').flush({ link: link('link-1', 'fresh') });
      await creating;
      await flush();
      expect(fixture.componentInstance.copyState()).toBeNull();
      expect(fixture.componentInstance.isBusy()).toBe(false);

      confirm();
      await flush();
      expect(fixture.componentInstance.copiedLinkId()).toBe('link-1');
    });

    it('copies the updated link, including no expiration, without creating another', async () => {
      await openMemory([link('link-1', 'tok', '2030-01-01T00:00:00Z'), link('link-2', 'other')]);
      fixture.componentInstance.selectedExpiryHours = null;

      const extending = fixture.componentInstance.extend(fixture.componentInstance.links()[0]);
      const update = http.expectOne('/api/v1/sharing/link-1');
      expect(update.request.method).toBe('PATCH');
      expect(update.request.body).toEqual({ neverExpires: true });
      update.flush({ link: link('link-1', 'tok-updated') });
      await extending;
      await flush();

      http.expectNone('/api/v1/sharing');
      expect(written).toEqual([`${location.origin}/s/tok-updated`]);
      expect(fixture.componentInstance.links().length).toBe(2);
    });

    it('copies after materialising a lazy target, once', async () => {
      let finish!: (id: string) => void;
      const opened = open({
        targetType: 'album',
        targetId: '',
        internalPath: '/lookback?day=09-25&year=2021',
        resolveTarget: () => new Promise<string>((resolve) => (finish = resolve)),
      });
      await opened;
      expect(written).toEqual([]);

      const creating = fixture.componentInstance.createLink();
      finish('album-9');
      await flush();
      http.expectOne('/api/v1/sharing').flush({ link: link('link-1', 'fresh') });
      await creating;
      await flush();

      expect(written).toEqual([`${location.origin}/s/fresh`]);
    });

    it('writes nothing when creating fails', async () => {
      await openMemory();

      const creating = fixture.componentInstance.createLink();
      await flush();
      http.expectOne('/api/v1/sharing').flush('no', { status: 500, statusText: 'Server Error' });
      await expect(creating).rejects.toBeDefined();
      await flush();

      expect(written).toEqual([]);
      expect(fixture.componentInstance.copyState()).toBeNull();
      expect(fixture.componentInstance.isBusy()).toBe(false);
    });

    it('writes nothing when updating fails', async () => {
      await openMemory([link('link-1', 'tok')]);

      const extending = fixture.componentInstance.extend(fixture.componentInstance.links()[0]);
      http.expectOne('/api/v1/sharing/link-1').flush('no', { status: 500, statusText: 'Server Error' });
      await expect(extending).rejects.toBeDefined();
      await flush();

      expect(written).toEqual([]);
      expect(fixture.componentInstance.copyState()).toBeNull();
      expect(fixture.componentInstance.isBusy()).toBe(false);
    });

    it('writes nothing when the target cannot be materialised', async () => {
      const opened = open({
        targetType: 'album',
        targetId: '',
        internalPath: '/lookback',
        resolveTarget: () => Promise.reject(new Error('nope')),
      });
      await opened;

      await expect(fixture.componentInstance.createLink()).rejects.toBeDefined();
      await flush();

      expect(written).toEqual([]);
      expect(fixture.componentInstance.isBusy()).toBe(false);
      http.expectNone('/api/v1/sharing');
    });

    it('writes nothing when a promise-backed write is used and the request fails', async () => {
      const writeText = vi.fn(() => Promise.resolve());
      installClipboardItem(() => Promise.reject(new Error('aborted')), writeText);
      await openMemory();

      const creating = fixture.componentInstance.createLink();
      await flush();
      http.expectOne('/api/v1/sharing').flush('no', { status: 500, statusText: 'Server Error' });
      await expect(creating).rejects.toBeDefined();
      await flush();

      expect(writeText).not.toHaveBeenCalled();
    });

    it('falls back to plain text when the promise-backed write is refused', async () => {
      installClipboardItem(() => Promise.reject(new Error('denied')));
      await openMemory();

      const creating = fixture.componentInstance.createLink();
      await flush();
      http.expectOne('/api/v1/sharing').flush({ link: link('link-1', 'fresh') });
      await creating;
      await flush();

      expect(written).toEqual([`${location.origin}/s/fresh`]);
      expect(fixture.componentInstance.copiedLinkId()).toBe('link-1');
    });

    for (const [name, clipboard] of [
      ['rejects', { writeText: () => Promise.reject(new Error('denied')) }],
      ['is missing', undefined],
    ] as const) {
      it(`keeps the created link when the clipboard ${name}, and Copy works later without another request`, async () => {
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: clipboard });
        await openMemory();
        let changed = 0;
        fixture.componentInstance.changed.subscribe(() => changed++);

        const creating = fixture.componentInstance.createLink();
        await flush();
        http.expectOne('/api/v1/sharing').flush({ link: link('link-1', 'fresh') });
        await creating;
        await flush();
        fixture.detectChanges();

        const state = fixture.componentInstance.copyState();
        expect(state).toEqual({ linkId: 'link-1', status: 'failed' });
        expect(fixture.componentInstance.copiedLinkId()).toBeNull();
        expect(fixture.componentInstance.links().map((l) => l.id)).toEqual(['link-1']);
        expect(changed).toBe(1);
        expect(fixture.componentInstance.isBusy()).toBe(false);
        expect(document.body.textContent).toContain('Couldn’t copy automatically');

        Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: { writeText: (text: string) => (written.push(text), Promise.resolve()) },
        });
        await fixture.componentInstance.copy(fixture.componentInstance.links()[0]);
        expect(written).toEqual([`${location.origin}/s/fresh`]);
        expect(fixture.componentInstance.copiedLinkId()).toBe('link-1');
        http.expectNone('/api/v1/sharing');
      });
    }

    it('does not leave an earlier Copied! standing after a failed new attempt', async () => {
      await openMemory([link('link-1', 'tok')]);
      await fixture.componentInstance.copy(fixture.componentInstance.links()[0]);
      expect(fixture.componentInstance.copiedLinkId()).toBe('link-1');

      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: () => Promise.reject(new Error('denied')) },
      });
      await fixture.componentInstance.copy(fixture.componentInstance.links()[0]);

      expect(fixture.componentInstance.copiedLinkId()).toBeNull();
      expect(fixture.componentInstance.copyState()?.status).toBe('failed');
    });

    it('does not copy when opening, closing, listing, or revoking', async () => {
      await openMemory([link('link-1', 'tok')]);
      fixture.componentInstance.close();
      expect(written).toEqual([]);
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

  });
});
