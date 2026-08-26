import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AlbumDetail, AlbumSummary } from './api-models';

/** Raw HTTP calls for albums. */
@Injectable({ providedIn: 'root' })
export class AlbumsApiService {
  private readonly http = inject(HttpClient);

  list(): Promise<{ albums: AlbumSummary[] }> {
    return firstValueFrom(this.http.get<{ albums: AlbumSummary[] }>('/api/v1/albums'));
  }

  get(albumId: string): Promise<AlbumDetail> {
    return firstValueFrom(this.http.get<AlbumDetail>(`/api/v1/albums/${albumId}`));
  }

  create(title: string, assetIds: string[]): Promise<{ albumId: string }> {
    return firstValueFrom(
      this.http.post<{ albumId: string }>('/api/v1/albums', { title, assetIds }),
    );
  }

  addAssets(albumId: string, assetIds: string[]): Promise<void> {
    return firstValueFrom(this.http.post<void>(`/api/v1/albums/${albumId}/assets`, { assetIds }));
  }

  removeAsset(albumId: string, assetId: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`/api/v1/albums/${albumId}/assets/${assetId}`));
  }

  rename(albumId: string, title: string): Promise<void> {
    return firstValueFrom(this.http.patch<void>(`/api/v1/albums/${albumId}`, { title }));
  }

  remove(albumId: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`/api/v1/albums/${albumId}`));
  }
}
