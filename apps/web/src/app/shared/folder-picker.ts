import { Component, inject, OnInit, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LibraryApiService } from '../core/api/library-api.service';
import { BrowseEntry } from '../core/api/api-models';

/**
 * Picks a photo folder from the server's mounted volumes (Docker: whatever is
 * mounted under /library). Falls back to a typed path only when the server has
 * no browsable volumes (bare-metal dev).
 */
@Component({
  selector: 'app-folder-picker',
  imports: [FormsModule],
  templateUrl: './folder-picker.html',
  styleUrl: './folder-picker.scss',
})
export class FolderPicker implements OnInit {
  private readonly api = inject(LibraryApiService);

  /** Emits the chosen absolute path. */
  readonly picked = output<string>();

  readonly currentPath = signal<string | null>(null);
  readonly entries = signal<BrowseEntry[]>([]);
  readonly isManualMode = signal(false);
  readonly isLoaded = signal(false);

  manualPath = '';
  private readonly history: Array<string | null> = [];

  ngOnInit(): void {
    void this.load(undefined);
  }

  async open(entry: BrowseEntry): Promise<void> {
    this.history.push(this.currentPath());
    await this.load(entry.path);
  }

  async goBack(): Promise<void> {
    const previous = this.history.pop();
    await this.load(previous ?? undefined);
  }

  get canGoBack(): boolean {
    return this.history.length > 0;
  }

  useCurrent(): void {
    const path = this.currentPath();
    if (path) {
      this.picked.emit(path);
    }
  }

  useManual(): void {
    const path = this.manualPath.trim();
    if (path.length > 0) {
      this.picked.emit(path);
    }
  }

  switchToManual(): void {
    this.isManualMode.set(true);
  }

  private async load(path: string | undefined): Promise<void> {
    try {
      const listing = await this.api.browse(path);
      this.currentPath.set(listing.path);
      this.entries.set(listing.entries);
      // No mounted volumes at all -> typed path is the only option.
      if (listing.path === null && listing.entries.length === 0) {
        this.isManualMode.set(true);
      }
    } catch {
      this.isManualMode.set(true);
    } finally {
      this.isLoaded.set(true);
    }
  }
}
