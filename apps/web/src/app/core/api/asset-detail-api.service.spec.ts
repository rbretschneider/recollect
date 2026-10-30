import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { AssetDetail } from './api-models';
import { AssetDetailApiService } from './asset-detail-api.service';

describe('AssetDetailApiService', () => {
  let service: AssetDetailApiService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(AssetDetailApiService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('requests the detail route for the asset and resolves with the body', async () => {
    const pending = service.get('asset-1');

    const request = http.expectOne('/api/v1/assets/asset-1/detail');
    expect(request.request.method).toBe('GET');
    const body = { id: 'asset-1' } as AssetDetail;
    request.flush(body);

    expect(await pending).toEqual(body);
  });

  it('rejects when the server fails, so callers decide how to degrade', async () => {
    const pending = service.get('asset-1');

    http
      .expectOne('/api/v1/assets/asset-1/detail')
      .flush('nope', { status: 500, statusText: 'Server Error' });

    await expect(pending).rejects.toBeDefined();
  });

  it('asks the server again on every call (no cache)', () => {
    void service.get('asset-1');
    void service.get('asset-1');

    expect(http.match('/api/v1/assets/asset-1/detail').length).toBe(2);
  });
});
