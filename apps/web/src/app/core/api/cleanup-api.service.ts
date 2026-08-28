import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';

export interface JunkSuggestion {
  assetId: string;
  fileName: string;
  sizeBytes: number;
  mediaType: string;
  reason: string;
}

export interface SpaceHogSuggestion {
  assetId: string;
  fileName: string;
  sizeBytes: number;
  mediaType: string;
  durationMs: number | null;
  bitrate: number | null;
  estimatedBytes: number | null;
  converting: boolean;
}

export interface CleanupSuggestions {
  junk: JunkSuggestion[];
  hogs: SpaceHogSuggestion[];
  projectedSavingsBytes: number;
}

/** The cleanup advisor: junk flags and space hogs (delete grant). */
@Injectable({ providedIn: 'root' })
export class CleanupApiService {
  private readonly http = inject(HttpClient);

  suggestions(): Promise<CleanupSuggestions> {
    return firstValueFrom(this.http.get<CleanupSuggestions>('/api/v1/cleanup/suggestions'));
  }

  dismiss(assetIds: string[]): Promise<void> {
    return firstValueFrom(this.http.post<void>('/api/v1/cleanup/dismiss', { assetIds }));
  }

  convert(assetId: string): Promise<{ accepted: true }> {
    return firstValueFrom(
      this.http.post<{ accepted: true }>(`/api/v1/cleanup/convert/${assetId}`, {}),
    );
  }
}
