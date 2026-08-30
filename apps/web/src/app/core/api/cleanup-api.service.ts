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
  /** Images CLIP thinks are probably accidental (floor / all-dark / blur). */
  accidental: JunkSuggestion[];
  projectedSavingsBytes: number;
}

export interface ConvertedOriginal {
  assetId: string;
  fileName: string;
  sizeBytes: number;
  deletesAt: string;
  /** A restore is queued/running for this original (a slow cross-volume copy). */
  restoring: boolean;
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

  convert(assetId: string, codec: 'hevc' | 'h264'): Promise<{ accepted: true }> {
    return firstValueFrom(
      this.http.post<{ accepted: true }>(`/api/v1/cleanup/convert/${assetId}`, { codec }),
    );
  }

  listConverted(): Promise<{ originals: ConvertedOriginal[] }> {
    return firstValueFrom(
      this.http.get<{ originals: ConvertedOriginal[] }>('/api/v1/cleanup/converted'),
    );
  }

  restore(assetId: string): Promise<{ accepted: true }> {
    return firstValueFrom(
      this.http.post<{ accepted: true }>(`/api/v1/cleanup/restore/${assetId}`, {}),
    );
  }
}
