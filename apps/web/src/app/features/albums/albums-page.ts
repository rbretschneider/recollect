import { Component, inject, OnInit, signal } from '@angular/core';
import { assetThumbUrl } from '../../core/api/photos-api.service';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AlbumsApiService } from '../../core/api/albums-api.service';
import { AlbumSummary } from '../../core/api/api-models';
import { AuthStateService } from '../../core/auth/auth-state.service';
import { AppTopbar } from '../../shared/app-topbar';
import { Sheet } from '../../shared/sheet';
import { PageLoading } from '../../shared/page-loading';
import { LoadError } from '../../shared/load-error';
import { ToastService } from '../../shared/toast.service';

/** The Albums tab: manual collections, PhotoPrism-style. */
@Component({
  selector: 'app-albums-page',
  imports: [PageLoading, AppTopbar, FormsModule, RouterLink, Sheet, LoadError],
  templateUrl: './albums-page.html',
  styleUrl: './albums-page.scss',
})
export class AlbumsPage implements OnInit {
  private readonly api = inject(AlbumsApiService);
  private readonly auth = inject(AuthStateService);
  private readonly router = inject(Router);
  private readonly toasts = inject(ToastService);

  readonly albums = signal<AlbumSummary[]>([]);
  readonly isLoaded = signal(false);
  readonly loadFailed = signal(false);
  readonly isCreating = signal(false);
  readonly isSaving = signal(false);

  newTitle = '';

  get canWrite(): boolean {
    const permission = this.auth.user()?.permission;
    return permission === 'write' || permission === 'delete';
  }

  ngOnInit(): void {
    void this.reload();
  }

  coverUrl(album: AlbumSummary): string | null {
    return album.coverAssetId ? assetThumbUrl(album.coverAssetId, 720) : null;
  }

  startCreating(): void {
    this.newTitle = '';
    this.isCreating.set(true);
  }

  async create(): Promise<void> {
    const title = this.newTitle.trim();
    if (title.length === 0 || this.isSaving()) {
      return;
    }
    this.isSaving.set(true);
    try {
      const { albumId } = await this.api.create(title, []);
      this.isCreating.set(false);
      await this.router.navigate(['/albums', albumId]);
    } catch {
      this.toasts.error("Couldn't create the album.", { label: 'Retry', run: () => void this.create() });
    } finally {
      this.isSaving.set(false);
    }
  }

  protected async reload(): Promise<void> {
    this.loadFailed.set(false);
    try {
      const { albums } = await this.api.list();
      this.albums.set(albums);
      this.isLoaded.set(true);
    } catch {
      this.loadFailed.set(true);
    }
  }
}
