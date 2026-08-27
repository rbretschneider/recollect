import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AlbumsApiService } from '../../core/api/albums-api.service';
import { AlbumSummary } from '../../core/api/api-models';
import { AuthStateService } from '../../core/auth/auth-state.service';
import { AppTopbar } from '../../shared/app-topbar';
import { BottomNav } from '../../shared/bottom-nav';
import { Sheet } from '../../shared/sheet';
import { PageLoading } from '../../shared/page-loading';

/** The Albums tab: manual collections, PhotoPrism-style. */
@Component({
  selector: 'app-albums-page',
  imports: [PageLoading, AppTopbar, BottomNav, FormsModule, RouterLink, Sheet],
  templateUrl: './albums-page.html',
  styleUrl: './albums-page.scss',
})
export class AlbumsPage implements OnInit {
  private readonly api = inject(AlbumsApiService);
  private readonly auth = inject(AuthStateService);
  private readonly router = inject(Router);

  readonly albums = signal<AlbumSummary[]>([]);
  readonly isLoaded = signal(false);
  readonly isCreating = signal(false);

  newTitle = '';

  get canWrite(): boolean {
    const permission = this.auth.user()?.permission;
    return permission === 'write' || permission === 'delete';
  }

  ngOnInit(): void {
    void this.reload();
  }

  coverUrl(album: AlbumSummary): string | null {
    return album.coverAssetId ? `/api/v1/assets/${album.coverAssetId}/thumb/720` : null;
  }

  startCreating(): void {
    this.newTitle = '';
    this.isCreating.set(true);
  }

  async create(): Promise<void> {
    const title = this.newTitle.trim();
    if (title.length === 0) {
      return;
    }
    const { albumId } = await this.api.create(title, []);
    this.isCreating.set(false);
    await this.router.navigate(['/albums', albumId]);
  }

  private async reload(): Promise<void> {
    const { albums } = await this.api.list();
    this.albums.set(albums);
    this.isLoaded.set(true);
  }
}
