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
  /** The date currently on record, and where it came from. */
  capturedAt: string;
  capturedAtSource: string;
  title: string | null;
  /** Title and date read off the cassette label, when the filename is a digitised tape. */
  labelGuess: TapeLabelGuess | null;
}

/** What a tape's label says about it, for the convert sheet to prefill. */
export interface TapeLabelGuess {
  label: string;
  title: string;
  /** ISO calendar date (YYYY-MM-DD), or null when the label has no year. */
  date: string | null;
  precision: 'day' | 'year' | null;
  yearEnd: number | null;
}

/** What the person confirmed in the convert sheet. */
export interface ConvertOptions {
  codec: 'hevc' | 'h264';
  title?: string;
  /** ISO instant. */
  capturedAt?: string;
  tzOffsetMin?: number;
}

export interface CleanupSuggestions {
  junk: JunkSuggestion[];
  hogs: SpaceHogSuggestion[];
  /** Images CLIP thinks are probably accidental (floor / all-dark / blur). */
  accidental: JunkSuggestion[];
  /** Redundant copies of near-duplicate shots (the best of each group is kept). */
  duplicates: JunkSuggestion[];
  projectedSavingsBytes: number;
}

export interface ConvertedOriginal {
  assetId: string;
  fileName: string;
  sizeBytes: number;
  deletesAt: string;
  /** A restore is queued/running for this original (a slow cross-volume copy). */
  restoring: boolean;
  /** Why the purge is refusing to delete it, or null when the conversion checks out. */
  held: string | null;
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

  convert(assetId: string, options: ConvertOptions): Promise<{ accepted: true }> {
    return firstValueFrom(
      this.http.post<{ accepted: true }>(`/api/v1/cleanup/convert/${assetId}`, options),
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
