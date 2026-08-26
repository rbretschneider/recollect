import { Component, computed, inject, OnInit, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AlbumsApiService } from '../core/api/albums-api.service';
import { AlbumSummary } from '../core/api/api-models';

/**
 * Typeahead album picker: one box filters existing albums as you type, and the
 * same text becomes the name of a new album when nothing matches exactly.
 */
@Component({
  selector: 'app-album-picker',
  imports: [FormsModule],
  templateUrl: './album-picker.html',
  styleUrl: './album-picker.scss',
})
export class AlbumPicker implements OnInit {
  private readonly api = inject(AlbumsApiService);

  /** Emits the chosen album id (existing or freshly created). */
  readonly picked = output<string>();
  readonly cancelled = output<void>();

  readonly albums = signal<AlbumSummary[]>([]);
  readonly filterText = signal('');
  readonly isBusy = signal(false);

  readonly filtered = computed(() => {
    const needle = this.filterText().trim().toLowerCase();
    if (needle.length === 0) {
      return this.albums();
    }
    return this.albums().filter((album) => album.title.toLowerCase().includes(needle));
  });

  /** Offer creation only when the typed name isn't already an exact album. */
  readonly canCreate = computed(() => {
    const name = this.filterText().trim();
    return (
      name.length > 0 &&
      !this.albums().some((album) => album.title.toLowerCase() === name.toLowerCase())
    );
  });

  ngOnInit(): void {
    void this.load();
  }

  coverUrl(album: AlbumSummary): string | null {
    return album.coverAssetId ? `/api/v1/assets/${album.coverAssetId}/thumb/240` : null;
  }

  choose(albumId: string): void {
    this.picked.emit(albumId);
  }

  async createAndChoose(): Promise<void> {
    const title = this.filterText().trim();
    if (title.length === 0 || this.isBusy()) {
      return;
    }
    this.isBusy.set(true);
    try {
      const { albumId } = await this.api.create(title, []);
      this.picked.emit(albumId);
    } finally {
      this.isBusy.set(false);
    }
  }

  private async load(): Promise<void> {
    const { albums } = await this.api.list();
    this.albums.set(albums);
  }
}
