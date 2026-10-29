import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AssetDetail } from './api-models';

/** Raw HTTP call for one asset's full metadata (the photo details panel). */
@Injectable({ providedIn: 'root' })
export class AssetDetailApiService {
  private readonly http = inject(HttpClient);

  /** Fetches the full metadata record for an asset. Not cached: edits and rotations change it. */
  get(assetId: string): Promise<AssetDetail> {
    return firstValueFrom(this.http.get<AssetDetail>(`/api/v1/assets/${assetId}/detail`));
  }
}
