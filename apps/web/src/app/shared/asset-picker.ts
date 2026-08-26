import { Component, inject, input, OnInit, output, signal } from '@angular/core';
import { PhotosApiService } from '../core/api/photos-api.service';
import { TimelineAsset } from '../core/api/api-models';

/** How many timeline assets to fetch per "Load more". */
const PAGE_SIZE = 60;

/**
 * Overlay for picking extra photos off the timeline — used when a Memory needs
 * assets beyond what a suggestion proposed. Multi-select, paged, and blind to
 * why the caller wants them; it just returns the chosen ids.
 */
@Component({
  selector: 'app-asset-picker',
  imports: [],
  templateUrl: './asset-picker.html',
  styleUrl: './asset-picker.scss',
})
export class AssetPicker implements OnInit {
  private readonly photosApi = inject(PhotosApiService);

  /** Assets already in the caller's selection; shown as added, not re-pickable. */
  readonly excludeIds = input<ReadonlySet<string>>(new Set());

  /** Emits the newly chosen asset ids. */
  readonly picked = output<string[]>();
  readonly cancelled = output<void>();

  readonly items = signal<TimelineAsset[]>([]);
  readonly chosenIds = signal<ReadonlySet<string>>(new Set());
  readonly isLoading = signal(false);
  readonly isComplete = signal(false);

  private nextCursor: string | null = null;

  ngOnInit(): void {
    void this.loadMore();
  }

  thumbUrl(assetId: string): string {
    return this.photosApi.thumbnailUrl(assetId, 240);
  }

  isExcluded(assetId: string): boolean {
    return this.excludeIds().has(assetId);
  }

  isChosen(assetId: string): boolean {
    return this.chosenIds().has(assetId);
  }

  chosenCount(): number {
    return this.chosenIds().size;
  }

  toggle(assetId: string): void {
    if (this.isExcluded(assetId)) {
      return;
    }
    this.chosenIds.update((current) => {
      const next = new Set(current);
      if (next.has(assetId)) {
        next.delete(assetId);
      } else {
        next.add(assetId);
      }
      return next;
    });
  }

  async loadMore(): Promise<void> {
    if (this.isLoading() || this.isComplete()) {
      return;
    }
    this.isLoading.set(true);
    try {
      const page = await this.photosApi.getTimelinePage(this.nextCursor, PAGE_SIZE);
      this.items.update((existing) => [...existing, ...page.items]);
      this.nextCursor = page.nextCursor;
      if (page.nextCursor === null) {
        this.isComplete.set(true);
      }
    } finally {
      this.isLoading.set(false);
    }
  }

  confirm(): void {
    this.picked.emit([...this.chosenIds()]);
  }

  cancel(): void {
    this.cancelled.emit();
  }
}
