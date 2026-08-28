import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { TimelineAsset, TimelinePage } from './api-models';

/** Raw HTTP calls for the photo timeline. */
@Injectable({ providedIn: 'root' })
export class PhotosApiService {
  private readonly http = inject(HttpClient);

  getTimelinePage(
    cursor: string | null,
    limit: number,
    favoritesOnly = false,
  ): Promise<TimelinePage> {
    let params = new HttpParams().set('limit', limit);
    if (cursor) {
      params = params.set('cursor', cursor);
    }
    if (favoritesOnly) {
      params = params.set('favorites', '1');
    }
    return firstValueFrom(this.http.get<TimelinePage>('/api/v1/assets', { params }));
  }

  setFavorite(assetId: string, on: boolean): Promise<void> {
    const url = `/api/v1/assets/${assetId}/favorite`;
    return firstValueFrom(on ? this.http.put<void>(url, {}) : this.http.delete<void>(url));
  }

  /** Hydrates full asset records for a list of ids, preserving order — used by
   *  detail pages that hold only ids (memories, albums) to feed the viewer. */
  items(assetIds: string[]): Promise<TimelineAsset[]> {
    return firstValueFrom(
      this.http.post<{ items: TimelineAsset[] }>('/api/v1/assets/items', { assetIds }),
    ).then((response) => response.items);
  }

  /** URL for an asset thumbnail at a generated size (240 | 720 | 1440). */
  thumbnailUrl(assetId: string, size: 240 | 720 | 1440): string {
    return `/api/v1/assets/${assetId}/thumb/${size}`;
  }
}

/** Standalone thumbnail-URL builder for template helpers that don't hold the
 *  service — one definition to change if the route ever versions. */
export function assetThumbUrl(assetId: string, size: 240 | 720 | 1440 = 240): string {
  return `/api/v1/assets/${assetId}/thumb/${size}`;
}
