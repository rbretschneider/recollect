import { Component, inject, OnInit, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AlbumsApiService } from '../core/api/albums-api.service';
import { AlbumSummary } from '../core/api/api-models';

/** Overlay for choosing an existing album or creating a new one on the spot. */
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

  newTitle = '';

  ngOnInit(): void {
    void this.load();
  }

  choose(albumId: string): void {
    this.picked.emit(albumId);
  }

  async createAndChoose(): Promise<void> {
    const title = this.newTitle.trim();
    if (title.length === 0) {
      return;
    }
    const { albumId } = await this.api.create(title, []);
    this.picked.emit(albumId);
  }

  private async load(): Promise<void> {
    const { albums } = await this.api.list();
    this.albums.set(albums);
  }
}
