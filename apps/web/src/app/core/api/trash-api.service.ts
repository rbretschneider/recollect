import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';

/** A trashed item as returned by the server. */
export interface TrashItem {
  assetId: string;
  fileName: string;
  trashedAt: string;
  purgeAt: string;
}

/** Raw HTTP calls for trash operations (delete grant required server-side). */
@Injectable({ providedIn: 'root' })
export class TrashApiService {
  private readonly http = inject(HttpClient);

  list(): Promise<{ items: TrashItem[] }> {
    return firstValueFrom(this.http.get<{ items: TrashItem[] }>('/api/v1/trash'));
  }

  trashAssets(assetIds: string[]): Promise<{ trashed: number }> {
    return firstValueFrom(this.http.post<{ trashed: number }>('/api/v1/trash', { assetIds }));
  }

  restoreAssets(assetIds: string[]): Promise<{ restored: number }> {
    return firstValueFrom(
      this.http.post<{ restored: number }>('/api/v1/trash/restore', { assetIds }),
    );
  }
}
