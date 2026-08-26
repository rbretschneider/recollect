import { Component, inject, OnInit, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AlbumsApiService } from '../../core/api/albums-api.service';
import { AlbumDetail, TimelineAsset } from '../../core/api/api-models';
import { AuthStateService } from '../../core/auth/auth-state.service';
import { EditModeService } from '../../core/edit-mode.service';
import { BottomNav } from '../../shared/bottom-nav';
import { EditToggle } from '../../shared/edit-toggle';
import { ShareButton } from '../../shared/share-button';
import { AssetViewer } from '../viewer/asset-viewer';

/** One album: grid, viewer, share, remove-from-album. */
@Component({
  selector: 'app-album-detail-page',
  imports: [AssetViewer, BottomNav, EditToggle, RouterLink, ShareButton],
  templateUrl: './album-detail-page.html',
  styleUrl: './album-detail-page.scss',
})
export class AlbumDetailPage implements OnInit {
  private readonly api = inject(AlbumsApiService);
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthStateService);
  protected readonly editMode = inject(EditModeService);

  readonly detail = signal<AlbumDetail | null>(null);
  readonly viewerAssets = signal<TimelineAsset[]>([]);
  readonly viewerIndex = signal<number | null>(null);

  get canWrite(): boolean {
    const permission = this.auth.user()?.permission;
    return permission === 'write' || permission === 'delete';
  }

  ngOnInit(): void {
    void this.load();
  }

  thumbUrl(assetId: string): string {
    return `/api/v1/assets/${assetId}/thumb/240`;
  }

  async openViewer(assetId: string): Promise<void> {
    const detail = this.detail();
    if (!detail) {
      return;
    }
    if (this.viewerAssets().length === 0) {
      await this.loadViewerAssets(detail.assetIds);
    }
    const index = this.viewerAssets().findIndex((asset) => asset.id === assetId);
    if (index >= 0) {
      this.viewerIndex.set(index);
    }
  }

  closeViewer(): void {
    this.viewerIndex.set(null);
  }

  async removeFromAlbum(assetId: string): Promise<void> {
    const detail = this.detail();
    if (!detail) {
      return;
    }
    await this.api.removeAsset(detail.id, assetId);
    this.detail.set({ ...detail, assetIds: detail.assetIds.filter((id) => id !== assetId) });
  }

  async deleteAlbum(): Promise<void> {
    const detail = this.detail();
    if (!detail || !confirm(`Delete the album "${detail.title}"? Photos are not affected.`)) {
      return;
    }
    await this.api.remove(detail.id);
    await this.router.navigateByUrl('/albums');
  }

  private async load(): Promise<void> {
    const albumId = this.route.snapshot.paramMap.get('id');
    if (!albumId) {
      return;
    }
    this.detail.set(await this.api.get(albumId));
  }

  private async loadViewerAssets(assetIds: string[]): Promise<void> {
    const assets: TimelineAsset[] = [];
    for (const id of assetIds) {
      try {
        const detail = await firstValueFrom(
          this.http.get<{
            id: string;
            mediaType: 'image' | 'video';
            capturedAt: string;
            width: number | null;
            height: number | null;
            durationMs: number | null;
          }>(`/api/v1/assets/${id}/detail`),
        );
        assets.push({ ...detail, capturedDay: detail.capturedAt.slice(0, 10), hasThumbnail: true });
      } catch {
        // Skip missing assets in the viewer.
      }
    }
    this.viewerAssets.set(assets);
  }
}
