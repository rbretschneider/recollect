import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';

/** Mirrors the server's FolderEntry. */
export interface FolderEntry {
  name: string;
  path: string;
  assetCount: number;
  coverAssetId: string | null;
}

/** Mirrors the server's FolderAsset. */
export interface FolderAsset {
  id: string;
  mediaType: 'image' | 'video';
  capturedAt: string;
  fileName: string;
  hasThumbnail: boolean;
}

/** Mirrors the server's FolderListing. */
export interface FolderListing {
  rootId: string;
  rootName: string;
  path: string;
  folders: FolderEntry[];
  assets: FolderAsset[];
}

/** Mirrors the server's RootEntry. */
export interface RootEntry {
  rootId: string;
  name: string;
  assetCount: number;
  coverAssetId: string | null;
}

/** Raw HTTP calls for the filesystem-shaped Folders view. */
@Injectable({ providedIn: 'root' })
export class FoldersApiService {
  private readonly http = inject(HttpClient);

  listRoots(): Promise<{ roots: RootEntry[] }> {
    return firstValueFrom(this.http.get<{ roots: RootEntry[] }>('/api/v1/folders'));
  }

  browse(rootId: string, path: string): Promise<FolderListing> {
    const params = new HttpParams().set('path', path);
    return firstValueFrom(this.http.get<FolderListing>(`/api/v1/folders/${rootId}`, { params }));
  }
}
