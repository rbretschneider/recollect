import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { SharedView, ShareLinkView } from './api-models';

/** Raw HTTP calls for share links and public shared views. */
@Injectable({ providedIn: 'root' })
export class SharingApiService {
  private readonly http = inject(HttpClient);

  createLink(
    targetType: 'memory' | 'album' | 'asset',
    targetId: string,
    includeJournal: boolean,
    expiresInHours: number | null,
  ): Promise<{ link: ShareLinkView }> {
    return firstValueFrom(
      this.http.post<{ link: ShareLinkView }>('/api/v1/sharing', {
        targetType,
        targetId,
        includeJournal,
        // null is the user explicitly choosing "until turned off" — send the
        // permanent opt-in so the server doesn't apply its bounded default.
        ...(expiresInHours === null ? { neverExpires: true } : { expiresInHours }),
      }),
    );
  }

  listFor(targetType: 'memory' | 'album' | 'asset', targetId: string): Promise<{ links: ShareLinkView[] }> {
    return firstValueFrom(
      this.http.get<{ links: ShareLinkView[] }>(`/api/v1/sharing/${targetType}/${targetId}`),
    );
  }

  revoke(linkId: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`/api/v1/sharing/${linkId}`));
  }

  /** Public: resolve a share token (no auth). */
  getShared(token: string): Promise<SharedView> {
    return firstValueFrom(this.http.get<SharedView>(`/api/v1/share/${token}`));
  }

  /** URL for a shared asset's thumbnail (no auth). */
  sharedThumbUrl(token: string, assetId: string, size: 240 | 720 | 1440): string {
    return `/api/v1/share/${token}/assets/${assetId}/thumb/${size}`;
  }
}
