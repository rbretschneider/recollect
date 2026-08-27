import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';

/** Mirrors the server's PersonSummary. */
export interface PersonSummary {
  id: string;
  name: string | null;
  faceCount: number;
  coverFaceId: string | null;
}

/** Mirrors the server's PersonFace. */
export interface PersonFace {
  id: string;
  assetId: string;
  quality: number;
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

  getFaces(personId: string): Promise<{ faces: PersonFace[] }> {
    return firstValueFrom(this.http.get<{ faces: PersonFace[] }>(`/api/v1/people/${personId}/faces`));
  }

  /** URL of a square face crop. */
  faceCropUrl(faceId: string): string {
    return `/api/v1/people/faces/${faceId}/crop`;
  }

  mergeInto(sourceId: string, targetPersonId: string): Promise<void> {
    return firstValueFrom(
      this.http.post<void>(`/api/v1/people/${sourceId}/merge-into`, { targetPersonId }),
    );
  }

  split(personId: string, faceIds: string[]): Promise<{ personId: string }> {
    return firstValueFrom(
      this.http.post<{ personId: string }>(`/api/v1/people/${personId}/split`, { faceIds }),
    );
  }

  ignoreFaces(faceIds: string[]): Promise<void> {
    return firstValueFrom(this.http.post<void>('/api/v1/people/faces/ignore', { faceIds }));
  }

  hide(personId: string): Promise<void> {
    return firstValueFrom(this.http.post<void>(`/api/v1/people/${personId}/hide`, {}));
  }

  disband(personId: string): Promise<{ reclustered: number }> {
    return firstValueFrom(
      this.http.post<{ reclustered: number }>(`/api/v1/people/${personId}/disband`, {}),
    );
  }
}
