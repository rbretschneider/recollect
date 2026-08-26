import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';

/** Mirrors the server's PersonSummary. */
export interface PersonSummary {
  id: string;
  name: string | null;
  faceCount: number;
  coverAssetId: string | null;
}

/** Raw HTTP calls for People. */
@Injectable({ providedIn: 'root' })
export class PeopleApiService {
  private readonly http = inject(HttpClient);

  list(): Promise<{ people: PersonSummary[] }> {
    return firstValueFrom(this.http.get<{ people: PersonSummary[] }>('/api/v1/people'));
  }

  getAssets(personId: string): Promise<{ assetIds: string[] }> {
    return firstValueFrom(
      this.http.get<{ assetIds: string[] }>(`/api/v1/people/${personId}/assets`),
    );
  }

  rename(personId: string, name: string): Promise<void> {
    return firstValueFrom(this.http.patch<void>(`/api/v1/people/${personId}`, { name }));
  }
}
