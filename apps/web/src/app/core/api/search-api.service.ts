import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';

/** Mirrors the server's SearchMemoryHit. */
export interface SearchMemoryHit {
  id: string;
  title: string;
  startAt: string;
  coverAssetId: string | null;
}

/** Mirrors the server's SearchAlbumHit. */
export interface SearchAlbumHit {
  id: string;
  title: string;
  coverAssetId: string | null;
}

/** Mirrors the server's SearchFolderHit. */
export interface SearchFolderHit {
  rootId: string;
  path: string;
  name: string;
}

/** Mirrors the server's SearchAssetHit. */
export interface SearchAssetHit {
  id: string;
  mediaType: 'image' | 'video';
  capturedAt: string;
  fileName: string;
}

/** Mirrors the server's SearchResults. */
/** Mirrors the server's SearchPersonHit. */
export interface SearchPersonHit {
  id: string;
  name: string;
  coverFaceId: string | null;
  faceCount: number;
}

export interface SearchResults {
  query: string;
  dateRange: { from: string; to: string; label: string } | null;
  memories: SearchMemoryHit[];
  albums: SearchAlbumHit[];
  folders: SearchFolderHit[];
  people: SearchPersonHit[];
  assets: SearchAssetHit[];
  semantic: SearchAssetHit[];
}

/** Raw HTTP calls for search. */
@Injectable({ providedIn: 'root' })
export class SearchApiService {
  private readonly http = inject(HttpClient);

  search(query: string): Promise<SearchResults> {
    const params = new HttpParams().set('q', query);
    return firstValueFrom(this.http.get<SearchResults>('/api/v1/search', { params }));
  }
}
