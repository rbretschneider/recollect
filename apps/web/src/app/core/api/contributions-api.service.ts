import { HttpClient, HttpEvent } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom, Observable } from 'rxjs';

/** A guest contribution link as shown to household members. */
export interface ContributionLinkView {
  id: string;
  token: string;
  poolView: boolean;
  expiresAt: string;
  uploadCount: number;
  createdAt: string;
}

/** What the public guest page renders. */
export interface ContributeView {
  albumTitle: string;
  poolView: boolean;
  expiresAt: string;
  poolAssetIds: string[];
}

/** One quarantined upload awaiting review. */
export interface GuestUploadView {
  id: string;
  uploaderName: string;
  originalFilename: string;
  sizeBytes: number;
  mediaType: string;
  status: string;
  createdAt: string;
}

/** Guest event contributions: public upload page + household review queue. */
@Injectable({ providedIn: 'root' })
export class ContributionsApiService {
  private readonly http = inject(HttpClient);

  // ---- household side -------------------------------------------------------

  createLink(
    albumId: string,
    poolView: boolean,
    expiresInHours: number,
  ): Promise<{ link: ContributionLinkView }> {
    return firstValueFrom(
      this.http.post<{ link: ContributionLinkView }>(
        `/api/v1/contributions/albums/${albumId}/links`,
        { poolView, expiresInHours },
      ),
    );
  }

  listLinks(albumId: string): Promise<{ links: ContributionLinkView[] }> {
    return firstValueFrom(
      this.http.get<{ links: ContributionLinkView[] }>(
        `/api/v1/contributions/albums/${albumId}/links`,
      ),
    );
  }

  revoke(linkId: string): Promise<{ ok: true }> {
    return firstValueFrom(this.http.delete<{ ok: true }>(`/api/v1/contributions/links/${linkId}`));
  }

  listPending(albumId: string): Promise<{ uploads: GuestUploadView[] }> {
    return firstValueFrom(
      this.http.get<{ uploads: GuestUploadView[] }>(
        `/api/v1/contributions/albums/${albumId}/uploads`,
      ),
    );
  }

  approve(ids: string[]): Promise<{ approved: number }> {
    return firstValueFrom(
      this.http.post<{ approved: number }>('/api/v1/contributions/uploads/approve', { ids }),
    );
  }

  reject(ids: string[]): Promise<{ rejected: number }> {
    return firstValueFrom(
      this.http.post<{ rejected: number }>('/api/v1/contributions/uploads/reject', { ids }),
    );
  }

  previewUrl(uploadId: string): string {
    return `/api/v1/contributions/uploads/${uploadId}/preview`;
  }

  // ---- public guest side ----------------------------------------------------

  getContributeView(token: string): Promise<ContributeView> {
    return firstValueFrom(this.http.get<ContributeView>(`/api/v1/contribute/${token}`));
  }

  /** Streams one file up with progress events (the caller renders the bar). */
  uploadFile(token: string, uploaderName: string, file: File): Observable<HttpEvent<{ id: string }>> {
    const form = new FormData();
    form.append('uploaderName', uploaderName);
    form.append('file', file, file.name);
    return this.http.post<{ id: string }>(`/api/v1/contribute/${token}/upload`, form, {
      reportProgress: true,
      observe: 'events',
    });
  }

  poolThumbUrl(token: string, assetId: string): string {
    return `/api/v1/contribute/${token}/assets/${assetId}/thumb/240`;
  }
}
