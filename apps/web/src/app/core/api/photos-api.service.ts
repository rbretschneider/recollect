import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { TimelinePage } from './api-models';

/** Raw HTTP calls for the photo timeline. */
@Injectable({ providedIn: 'root' })
export class PhotosApiService {
  private readonly http = inject(HttpClient);

  getTimelinePage(cursor: string | null, limit: number): Promise<TimelinePage> {
    let params = new HttpParams().set('limit', limit);
    if (cursor) {
      params = params.set('cursor', cursor);
    }
    return firstValueFrom(this.http.get<TimelinePage>('/api/v1/assets', { params }));
  }

  /** URL for an asset thumbnail at a generated size (240 | 720 | 1440). */
  thumbnailUrl(assetId: string, size: 240 | 720 | 1440): string {
    return `/api/v1/assets/${assetId}/thumb/${size}`;
  }
}
