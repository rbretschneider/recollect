import { Component, inject, OnInit, signal } from '@angular/core';
import { assetThumbUrl } from '../../core/api/photos-api.service';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AlbumsApiService } from '../../core/api/albums-api.service';
import { PhotosApiService } from '../../core/api/photos-api.service';
import {
  ContributionsApiService,
  GuestUploadView,
} from '../../core/api/contributions-api.service';
import { MemoriesApiService } from '../../core/api/memories-api.service';
import { SharingApiService } from '../../core/api/sharing-api.service';
import { AlbumDetail, TimelineAsset } from '../../core/api/api-models';
import { AuthStateService } from '../../core/auth/auth-state.service';
import { EditModeService } from '../../core/edit-mode.service';
import { AccountBadge } from '../../shared/account-badge';
import { MenuButton } from '../../shared/menu-button';
import { BackButton } from '../../shared/back-button';
import { PageLoading } from '../../shared/page-loading';
import { ConfirmService } from '../../shared/confirm.service';
import { EditToggle } from '../../shared/edit-toggle';
import { GuestLinkButton } from '../../shared/guest-link-button';
import { Icon } from '../../shared/icon';
import { ShareButton } from '../../shared/share-button';
import { Sheet } from '../../shared/sheet';
import { AssetViewer } from '../viewer/asset-viewer';

/** One album: grid, viewer, share, remove-from-album. */
@Component({
  selector: 'app-album-detail-page',
  imports: [
    AccountBadge,
    MenuButton,
    PageLoading,
    BackButton,
    AssetViewer,

    EditToggle,
    FormsModule,
    GuestLinkButton,
    Icon,
    RouterLink,
    ShareButton,
    Sheet,
  ],
  templateUrl: './album-detail-page.html',
  styleUrl: './album-detail-page.scss',
})
export class AlbumDetailPage implements OnInit {
  private readonly api = inject(AlbumsApiService);
  private readonly contributionsApi = inject(ContributionsApiService);
  private readonly sharingApi = inject(SharingApiService);
  private readonly memoriesApi = inject(MemoriesApiService);
  private readonly photosApi = inject(PhotosApiService);
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
  /** Guest uploads sitting in quarantine for this album. */
  readonly pendingUploads = signal<GuestUploadView[]>([]);
  readonly reviewBusy = signal(false);
  /** "Public until Sep 4" / "Guests until Sep 4" chips under the title. */
  readonly publicBadges = signal<string[]>([]);

  get canWrite(): boolean {
    const permission = this.auth.user()?.permission;
    return permission === 'write' || permission === 'delete';
  }

  ngOnInit(): void {
    void this.load();
  }

  thumbUrl(assetId: string): string {
    return assetThumbUrl(assetId);
  }

  async openViewer(assetId: string): Promise<void> {
    const detail = this.detail();
    // While editing, tiles are for removing — opening the viewer would fight
    // the ✕ overlays and accidental-tap removals.
    if (!detail || this.editMode.isEditing()) {
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
      await this.router.navigate(['/memories', memoryId], { queryParams: { new: 1 } });
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

  previewUrl(uploadId: string): string {
    return this.contributionsApi.previewUrl(uploadId);
  }

  async approveUploads(ids: string[]): Promise<void> {
    this.reviewBusy.set(true);
    try {
      await this.contributionsApi.approve(ids);
      await this.refreshAfterReview();
    } finally {
      this.reviewBusy.set(false);
    }
  }

  async rejectUploads(ids: string[]): Promise<void> {
    this.reviewBusy.set(true);
    try {
      await this.contributionsApi.reject(ids);
      await this.refreshAfterReview();
    } finally {
      this.reviewBusy.set(false);
    }
  }

  approveAll(): Promise<void> {
    return this.approveUploads(this.pendingUploads().map((upload) => upload.id));
  }

  /** Approvals change both the queue and the album grid; reload both. */
  private async refreshAfterReview(): Promise<void> {
    const detail = this.detail();
    if (!detail) {
      return;
    }
    const [fresh, { uploads }] = await Promise.all([
      this.api.get(detail.id),
      this.contributionsApi.listPending(detail.id),
    ]);
    this.detail.set(fresh);
    this.pendingUploads.set(uploads);
    // New album members invalidate the cached viewer list.
    this.viewerAssets.set([]);
  }

  private async load(): Promise<void> {
    const albumId = this.route.snapshot.paramMap.get('id');
    if (!albumId) {
      return;
    }
    this.detail.set(await this.api.get(albumId));
    if (this.canWrite) {
      const [{ uploads }, shares, guests] = await Promise.all([
        this.contributionsApi.listPending(albumId),
        this.sharingApi.listFor('album', albumId).catch(() => ({ links: [] })),
        this.contributionsApi.listLinks(albumId).catch(() => ({ links: [] })),
      ]);
      this.pendingUploads.set(uploads);
      const badges: string[] = [];
      const untilLabel = (iso: string | null): string =>
        iso === null
          ? 'no expiration'
          : new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      const share = shares.links[0];
      if (share) {
        badges.push(
          share.expiresAt === null ? 'Public — no expiration' : `Public until ${untilLabel(share.expiresAt)}`,
        );
      }
      const guest = guests.links[0];
      if (guest) {
        badges.push(`Guests until ${untilLabel(guest.expiresAt)}`);
      }
      this.publicBadges.set(badges);
    }
  }

  private async loadViewerAssets(assetIds: string[]): Promise<void> {
    // One batch request; the old per-asset loop cost N round trips.
    this.viewerAssets.set(await this.photosApi.items(assetIds));
  }
}
