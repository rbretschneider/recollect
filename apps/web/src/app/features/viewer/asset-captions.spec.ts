import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { AssetCaption } from '../../core/api/api-models';
import { AssetCaptionsApiService } from '../../core/api/asset-captions-api.service';
import { PeopleApiService } from '../../core/api/people-api.service';
import { ConfirmService } from '../../shared/confirm.service';
import { AssetCaptions } from './asset-captions';

const entry: AssetCaption = {
  id: 'caption-1',
  text: 'Hello\n<script>alert(1)</script>',
  saidByPersonId: null,
  saidByLabel: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe('AssetCaptions', () => {
  let fixture: ComponentFixture<AssetCaptions>;
  let component: AssetCaptions;
  let api: {
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    list: ReturnType<typeof vi.fn>;
  };
  let people: { attributionOptions: ReturnType<typeof vi.fn>; faceCropUrl: (id: string) => string };
  let confirm: { ask: ReturnType<typeof vi.fn> };
  beforeEach(() => {
    api = {
      create: vi.fn(async () => ({ caption: entry })),
      update: vi.fn(async () => ({ caption: entry })),
      delete: vi.fn(async () => {}),
      list: vi.fn(async () => ({ captions: [entry] })),
    };
    people = {
      attributionOptions: vi.fn(async () => ({
        people: [{ id: 'person-1', name: 'Alex', coverFaceId: null }],
      })),
      faceCropUrl: (id) => `/crop/${id}`,
    };
    confirm = { ask: vi.fn(async () => true) };
    TestBed.configureTestingModule({
      imports: [AssetCaptions],
      providers: [
        provideRouter([]),
        { provide: AssetCaptionsApiService, useValue: api },
        { provide: PeopleApiService, useValue: people },
        { provide: ConfirmService, useValue: confirm },
      ],
    });
    fixture = TestBed.createComponent(AssetCaptions);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('assetId', 'asset-1');
    fixture.componentRef.setInput('captions', [entry]);
    fixture.componentRef.setInput('canWrite', true);
    fixture.detectChanges();
  });
  const text = () => fixture.nativeElement.textContent as string;
  it('renders literal multiline text and an independent count with no executable markup', () => {
    expect(text()).toContain(entry.text);
    expect(text()).toContain('1 / 10');
    expect(fixture.nativeElement.querySelector('script')).toBeNull();
  });
  it('does not offer mutation controls to readers', () => {
    fixture.componentRef.setInput('canWrite', false);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('button')).toHaveLength(0);
    component.start();
    expect(component.editing()).toBe(false);
  });
  it('adds trimmed text and closes only after success; cancel leaves saved entries untouched', async () => {
    component.start();
    component.text = '  A new caption  ';
    await component.save();
    expect(api.create).toHaveBeenCalledWith('asset-1', {
      text: 'A new caption',
      saidByPersonId: null,
    });
    expect(component.editing()).toBe(false);
    component.start(entry);
    component.text = 'discard';
    component.cancel();
    expect(api.update).not.toHaveBeenCalled();
    expect(component.entries()[0].text).toBe(entry.text);
  });
  it('enforces nonblank and Unicode length bounds, retaining failed drafts and guarding duplicate submits', async () => {
    component.start();
    component.text = ' \n';
    await component.save();
    expect(api.create).not.toHaveBeenCalled();
    component.text = '🌻'.repeat(501);
    await component.save();
    expect(api.create).not.toHaveBeenCalled();
    const pending = deferred<{ caption: AssetCaption }>();
    api.create.mockReturnValue(pending.promise);
    component.text = '🌻'.repeat(500);
    const saving = component.save();
    await component.save();
    expect(api.create).toHaveBeenCalledTimes(1);
    expect(component.busy()).toBe(true);
    pending.reject(new Error('offline'));
    await saving;
    expect(component.editing()).toBe(true);
    expect(component.text).toBe('🌻'.repeat(500));
    expect(component.error()).toBeTruthy();
  });
  it('disables addition at ten and makes room after confirmed deletion', async () => {
    fixture.componentRef.setInput(
      'captions',
      Array.from({ length: 10 }, (_, i) => ({ ...entry, id: `caption-${i}` })),
    );
    fixture.detectChanges();
    component.start();
    expect(component.editing()).toBe(false);
    await component.remove(component.entries()[0]);
    expect(confirm.ask).toHaveBeenCalled();
    expect(api.delete).toHaveBeenCalledWith('asset-1', 'caption-0');
    expect(component.entries()).toHaveLength(9);
    component.start();
    expect(component.editing()).toBe(true);
  });
  it('preserves an orphan speaker on text-only edits and clears attribution explicitly', async () => {
    const orphan = { ...entry, saidByLabel: 'Former speaker' };
    component.start(orphan);
    component.text = 'revised';
    await component.save();
    expect(api.update).toHaveBeenCalledWith('asset-1', entry.id, { text: 'revised' });
    component.start(orphan);
    component.setAttribution(false);
    await component.save();
    expect(api.update).toHaveBeenLastCalledWith('asset-1', entry.id, {
      text: orphan.text,
      saidByPersonId: null,
    });
  });
  it('requires explicit selection and invalidates stale person selection when typing', async () => {
    component.start();
    component.text = 'A quote';
    component.setAttribution(true);
    await component.loadPeople();
    component.queryChanged('Alex');
    await component.save();
    expect(api.create).not.toHaveBeenCalled();
    component.choose({
      id: 'person-1',
      name: 'Alex',
      faceCount: 0,
      coverFaceId: null,
      favorite: false,
    });
    component.queryChanged('Sam');
    await component.save();
    expect(api.create).not.toHaveBeenCalled();
    component.choose({
      id: 'person-1',
      name: 'Alex',
      faceCount: 0,
      coverFaceId: null,
      favorite: false,
    });
    await component.save();
    expect(api.create).toHaveBeenCalledWith('asset-1', {
      text: 'A quote',
      saidByPersonId: 'person-1',
    });
  });
  it('keeps plain captions usable when people lookup fails', async () => {
    people.attributionOptions.mockRejectedValue(new Error('no ML'));
    component.start();
    component.setAttribution(true);
    await component.loadPeople();
    expect(component.peopleError()).toBeTruthy();
    component.setAttribution(false);
    component.text = 'plain';
    await component.save();
    expect(api.create).toHaveBeenCalled();
  });
  it.each(['success', 'failure'])(
    'ignores a late save %s across A-to-B-to-A navigation',
    async (result) => {
      const pending = deferred<{ caption: AssetCaption }>();
      api.create.mockReturnValueOnce(pending.promise);
      component.start();
      component.text = 'old draft';
      const saving = component.save();
      fixture.componentRef.setInput('assetId', 'asset-2');
      fixture.componentRef.setInput('captions', []);
      fixture.detectChanges();
      fixture.componentRef.setInput('assetId', 'asset-1');
      fixture.detectChanges();
      component.start();
      component.text = 'new draft';
      if (result === 'success') pending.resolve({ caption: entry });
      else pending.reject(new Error('old error'));
      await saving;
      expect(component.text).toBe('new draft');
      expect(component.entries()).toEqual([]);
      expect(component.editing()).toBe(true);
      expect(component.error()).toBe('');
    },
  );
  it('ignores late confirmation and deletion results after navigation', async () => {
    const pending = deferred<boolean>();
    confirm.ask.mockReturnValue(pending.promise);
    const removing = component.remove(entry);
    fixture.componentRef.setInput('assetId', 'asset-2');
    fixture.componentRef.setInput('captions', []);
    fixture.detectChanges();
    pending.resolve(true);
    await removing;
    expect(api.delete).not.toHaveBeenCalled();
  });
  it('refreshes after capacity conflict while preserving draft and never retries POST automatically', async () => {
    api.create.mockRejectedValue({ status: 409 });
    component.start();
    component.text = 'keep this';
    await component.save();
    expect(api.list).toHaveBeenCalledWith('asset-1');
    expect(component.text).toBe('keep this');
    expect(component.editing()).toBe(true);
    expect(api.create).toHaveBeenCalledTimes(1);
  });
  it('does not automatically turn a missing edited entry into a new entry', async () => {
    api.update.mockRejectedValue({ status: 404 });
    component.start(entry);
    component.text = 'keep';
    await component.save();
    expect(component.editing()).toBe(true);
    expect(component.text).toBe('keep');
    expect(api.create).not.toHaveBeenCalled();
  });
  it('does not let an old finally branch unlock a newer save', async () => {
    const first = deferred<{ caption: AssetCaption }>(),
      second = deferred<{ caption: AssetCaption }>();
    api.create.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    component.start();
    component.text = 'old';
    const oldSave = component.save();
    fixture.componentRef.setInput('assetId', 'asset-2');
    fixture.detectChanges();
    component.start();
    component.text = 'new';
    const newSave = component.save();
    first.reject(new Error('old failure'));
    await oldSave;
    expect(component.busy()).toBe(true);
    expect(component.text).toBe('new');
    expect(component.error()).toBe('');
    second.resolve({ caption: { ...entry, text: 'new' } });
    await newSave;
    expect(component.busy()).toBe(false);
  });
  it('ignores a stale deletion and stale people lookup after navigation', async () => {
    const deletion = deferred<void>(),
      lookup = deferred<{ people: never[] }>();
    api.delete.mockReturnValueOnce(deletion.promise);
    people.attributionOptions.mockReturnValueOnce(lookup.promise);
    const removing = component.remove(entry);
    await Promise.resolve();
    const loading = component.loadPeople();
    fixture.componentRef.setInput('assetId', 'asset-2');
    fixture.componentRef.setInput('captions', [entry]);
    fixture.detectChanges();
    deletion.resolve();
    lookup.reject(new Error('old lookup'));
    await Promise.all([removing, loading]);
    expect(component.entries()).toEqual([entry]);
    expect(component.peopleError()).toBe('');
    expect(component.busy()).toBe(false);
  });
  it('focuses the textarea and restores the invoking control after cancellation', async () => {
    const add = fixture.nativeElement.querySelector('[data-add]') as HTMLButtonElement;
    add.focus();
    add.click();
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.activeElement).toBe(fixture.nativeElement.querySelector('textarea'));
    component.cancel();
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.activeElement).toBe(add);
  });
  it('cancels an edit on Escape without dismissing the host', () => {
    component.start();
    fixture.detectChanges();
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    fixture.nativeElement.querySelector('textarea').dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(component.editing()).toBe(false);
    expect(api.update).not.toHaveBeenCalled();
  });
});
