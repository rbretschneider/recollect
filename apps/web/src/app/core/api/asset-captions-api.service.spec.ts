import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { AssetCaptionsApiService } from './asset-captions-api.service';
import { PeopleApiService } from './people-api.service';

describe('caption HTTP contracts', () => {
  let api: AssetCaptionsApiService, http: HttpTestingController;
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(AssetCaptionsApiService);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());
  it('lists authenticated asset entries', async () => {
    const result = api.list('photo');
    const req = http.expectOne('/api/v1/assets/photo/captions');
    expect(req.request.method).toBe('GET');
    req.flush({ captions: [] });
    expect(await result).toEqual({ captions: [] });
  });
  it('creates an attributed entry and passes server failures to the editor', async () => {
    const result = api.create('photo', { text: 'quote', saidByPersonId: 'person' });
    const req = http.expectOne('/api/v1/assets/photo/captions');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ text: 'quote', saidByPersonId: 'person' });
    req.flush({ message: 'full' }, { status: 409, statusText: 'Conflict' });
    await expect(result).rejects.toMatchObject({ status: 409 });
  });
  it('edits by stable identity with omitted versus explicitly cleared attribution', async () => {
    for (const body of [{ text: 'keep' }, { text: 'clear', saidByPersonId: null }]) {
      const result = api.update('photo', 'entry', body);
      const req = http.expectOne('/api/v1/assets/photo/captions/entry');
      expect(req.request.method).toBe('PATCH');
      expect(req.request.body).toEqual(body);
      req.flush({ caption: { id: 'entry', text: body.text } });
      expect((await result).caption.text).toBe(body.text);
    }
  });
  it('deletes by scoped identity', async () => {
    const result = api.delete('photo', 'entry');
    const req = http.expectOne('/api/v1/assets/photo/captions/entry');
    expect(req.request.method).toBe('DELETE');
    req.flush(null);
    await result;
  });
  it('uses the independent attribution lookup', async () => {
    const result = TestBed.inject(PeopleApiService).attributionOptions();
    http
      .expectOne('/api/v1/people/attribution-options')
      .flush({ people: [{ id: 'person', name: 'Alex', faceCount: 0, coverFaceId: null }] });
    expect((await result).people[0].faceCount).toBe(0);
  });
});
