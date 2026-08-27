import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AlbumsApiService } from '../../core/api/albums-api.service';
import { MemoriesApiService } from '../../core/api/memories-api.service';
import { AlbumDetail, TimelineAsset } from '../../core/api/api-models';
import { AuthStateService } from '../../core/auth/auth-state.service';
import { EditModeService } from '../../core/edit-mode.service';
import { BackButton } from '../../shared/back-button';
import { BottomNav } from '../../shared/bottom-nav';
import { PageLoading } from '../../shared/page-loading';
import { ConfirmService } from '../../shared/confirm.service';
import { EditToggle } from '../../shared/edit-toggle';
import { ShareButton } from '../../shared/share-button';
import { Sheet } from '../../shared/sheet';
import { AssetViewer } from '../viewer/asset-viewer';

/** One album: grid, viewer, share, remove-from-album. */
@Component({
  selector: 'app-album-detail-page',
  imports: [
    PageLoading,
    BackButton,
    AssetViewer,
    BottomNav,
    EditToggle,
    FormsModule,
    RouterLink,
    ShareButton,
    Sheet,
  ],
  templateUrl: './album-detail-page.html',
  styleUrl: './album-detail-page.scss',
})
export class AlbumDetailPage implements OnInit {
  private readonly api = inject(AlbumsApiService);
  private readonly memoriesApi = inject(MemoriesApiService);
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthStateService);
  private readonly confirms = inject(ConfirmService);
  protected readonly editMode = inject(EditModeService);

  readonly detail = signal<AlbumDetail | null>(null);
  readonly viewerAssets = signal<TimelineAsset[]>([]);
  readonly viewerIndex = signal<number | null>(null);
  readonly isDownloadSheetOpen = signal(false);
  /** Album → memory conversion: pick the subset that tells the story. */
  readonly isMemorySheetOpen = signal(false);
  readonly memorySelection = signal<ReadonlySet<string>>(new Set());
  readonly isCreatingMemory = signal(false);
  memoryTitleDraft = '';
  /** "3 / 24" while the one-by-one download runs; null when idle. */
  readonly downloadProgress = signal<string | null>(null);

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

  /** The viewer trashed a photo: it leaves this album's grid too. */
  onViewerDeleted(assetId: string): void {
    const detail = this.detail();
    if (detail) {
      this.detail.set({ ...detail, assetIds: detail.assetIds.filter((id) => id !== assetId) });
    }
    this.viewerAssets.update((assets) => assets.filter((asset) => asset.id !== assetId));
  }

  async removeFromAlbum(assetId: string): Promise<void> {
    const detail = this.detail();
    if (!detail) {
      return;
    }
    await this.api.removeAsset(detail.id, assetId);
    this.detail.set({ ...detail, assetIds: detail.assetIds.filter((id) => id !== assetId) });
  }

  downloadZip(): void {
    const detail = this.detail();
    if (!detail) {
      return;
    }
    const anchor = document.createElement('a');
    anchor.href = `/api/v1/albums/${detail.id}/download.zip`;
    anchor.download = '';
    anchor.click();
    this.isDownloadSheetOpen.set(false);
  }

  /** Saves every photo as its own file (the browser asks once to allow it). */
  async downloadEach(): Promise<void> {
    const detail = this.detail();
    if (!detail || this.downloadProgress() !== null) {
      return;
    }
    const ids = detail.assetIds;
    for (let index = 0; index < ids.length; index += 1) {
      this.downloadProgress.set(`${index + 1} / ${ids.length}`);
      const anchor = document.createElement('a');
      anchor.href = `/api/v1/assets/${ids[index]}/download`;
      anchor.download = '';
      anchor.click();
      // Browsers drop rapid-fire downloads; a beat between keeps them all.
      await new Promise((resolve) => setTimeout(resolve, 600));
    }
    this.downloadProgress.set(null);
    this.isDownloadSheetOpen.set(false);
  }

  /** Opens the conversion sheet with every album photo pre-selected. */
  startMemoryFromAlbum(): void {
    const detail = this.detail();
    if (!detail) {
      return;
    }
    this.memoryTitleDraft = detail.title;
    this.memorySelection.set(new Set(detail.assetIds));
    this.isMemorySheetOpen.set(true);
  }

  toggleMemoryAsset(assetId: string): void {
    this.memorySelection.update((current) => {
      const next = new Set(current);
      if (next.has(assetId)) {
        next.delete(assetId);
      } else {
        next.add(assetId);
      }
      return next;
    });
  }

  async createMemoryFromAlbum(): Promise<void> {
    const detail = this.detail();
    const title = this.memoryTitleDraft.trim();
    // Keep the album's ordering for the memory.
    const ids = detail?.assetIds.filter((id) => this.memorySelection().has(id)) ?? [];
    if (!detail || title.length === 0 || ids.length === 0 || this.isCreatingMemory()) {
      return;
    }
    this.isCreatingMemory.set(true);
    try {
      const { memoryId } = await this.memoriesApi.createMemory(title, ids);
      await this.router.navigate(['/memories', memoryId]);
    } finally {
      this.isCreatingMemory.set(false);
    }
  }

  async deleteAlbum(): Promise<void> {
    const detail = this.detail();
    if (!detail) {
      return;
    }
    const confirmed = await this.confirms.ask({
      title: `Delete “${detail.title}”?`,
      message: 'The album goes away for good. The photos in it are not affected.',
      confirmLabel: 'Delete album',
    });
    if (!confirmed) {
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
    // One batch request; the old per-asset loop cost N round trips.
    const { items } = await firstValueFrom(
      this.http.post<{ items: TimelineAsset[] }>('/api/v1/assets/items', { assetIds }),
    );
    this.viewerAssets.set(items);
  }
}
