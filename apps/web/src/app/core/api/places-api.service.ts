import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { TimelineAsset } from './api-models';

/** Mirrors the server's PlaceSummary. */
export interface PlaceView {
  label: string;
  town: string;
  gpsLat: number;
  gpsLon: number;
  assetCount: number;
  coverAssetId: string;
}

/** Raw HTTP calls for the Places view. */
@Injectable({ providedIn: 'root' })
export class PlacesApiService {
  private readonly http = inject(HttpClient);

  list(): Promise<{ places: PlaceView[] }> {
    return firstValueFrom(this.http.get<{ places: PlaceView[] }>('/api/v1/places'));
  }

  getAssets(label: string): Promise<{ items: TimelineAsset[] }> {
    const params = new HttpParams().set('label', label);
    return firstValueFrom(
      this.http.get<{ items: TimelineAsset[] }>('/api/v1/places/assets', { params }),
    );
  }
}
