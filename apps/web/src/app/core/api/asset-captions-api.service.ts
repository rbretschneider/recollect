import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AssetCaption } from './api-models';

export interface CaptionInput {
  text: string;
  saidByPersonId?: string | null;
}
@Injectable({ providedIn: 'root' })
export class AssetCaptionsApiService {
  private readonly http = inject(HttpClient);
  list(assetId: string): Promise<{ captions: AssetCaption[] }> {
    return firstValueFrom(
      this.http.get<{ captions: AssetCaption[] }>(`/api/v1/assets/${assetId}/captions`),
    );
  }
  create(assetId: string, body: CaptionInput): Promise<{ caption: AssetCaption }> {
    return firstValueFrom(
      this.http.post<{ caption: AssetCaption }>(`/api/v1/assets/${assetId}/captions`, body),
    );
  }
  update(assetId: string, id: string, body: CaptionInput): Promise<{ caption: AssetCaption }> {
    return firstValueFrom(
      this.http.patch<{ caption: AssetCaption }>(`/api/v1/assets/${assetId}/captions/${id}`, body),
    );
  }
  delete(assetId: string, id: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`/api/v1/assets/${assetId}/captions/${id}`));
  }
}
