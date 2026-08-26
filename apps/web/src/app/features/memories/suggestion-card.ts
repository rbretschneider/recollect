import { Component, computed, inject, input, OnInit, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MemoriesApiService } from '../../core/api/memories-api.service';
import { InboxSuggestion } from '../../core/api/api-models';
import { AssetPicker } from '../../shared/asset-picker';

/** What happened to a suggestion, so the grid can drop the card. */
export type SuggestionOutcome = 'created' | 'dismissed' | 'later';

/**
 * One suggestion in the review grid: name it, curate its photos (exclude/add),
 * then Create / Not an event / Later. Owns its own state so many cards can be
 * reviewed side by side without the page juggling per-card maps.
 */
@Component({
  selector: 'app-suggestion-card',
  imports: [FormsModule, AssetPicker],
  templateUrl: './suggestion-card.html',
  styleUrl: './suggestion-card.scss',
})
export class SuggestionCard implements OnInit {
  private readonly api = inject(MemoriesApiService);

  readonly suggestion = input.required<InboxSuggestion>();
  readonly canWrite = input<boolean>(false);
  /** Emitted once the card is decided; the grid removes it. */
  readonly decided = output<SuggestionOutcome>();

  readonly name = signal('');
  readonly isBusy = signal(false);
  readonly isPicking = signal(false);
  readonly isEditingPhotos = signal(false);

  private readonly suggestionAssetIds = signal<string[]>([]);
  private readonly addedAssetIds = signal<string[]>([]);
  readonly selectedIds = signal<ReadonlySet<string>>(new Set());

  readonly displayAssetIds = computed<string[]>(() => [
    ...this.suggestionAssetIds(),
    ...this.addedAssetIds(),
  ]);
  readonly selectedCount = computed<number>(
    () => this.displayAssetIds().filter((id) => this.selectedIds().has(id)).length,
  );
  readonly shownIds = computed<ReadonlySet<string>>(() => new Set(this.displayAssetIds()));

  ngOnInit(): void {
    this.name.set(this.suggestion().seedTitle);
    void this.loadAssets();
  }

  thumbUrl(assetId: string): string {
    return `/api/v1/assets/${assetId}/thumb/240`;
  }

  formatSpan(): string {
    const suggestion = this.suggestion();
    const start = new Date(suggestion.startAt);
    const end = new Date(suggestion.endAt);
    const day = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    return start.toDateString() === end.toDateString()
      ? day.format(start)
      : `${day.format(start)} – ${day.format(end)}`;
  }

  toggleEditPhotos(): void {
    this.isEditingPhotos.update((editing) => !editing);
  }

  isSelected(assetId: string): boolean {
    return this.selectedIds().has(assetId);
  }

  toggleSelected(assetId: string): void {
    this.selectedIds.update((current) => {
      const next = new Set(current);
      if (next.has(assetId)) {
        next.delete(assetId);
      } else {
        next.add(assetId);
      }
      return next;
    });
  }

  openPicker(): void {
    this.isPicking.set(true);
  }

  closePicker(): void {
    this.isPicking.set(false);
  }

  onPicked(assetIds: string[]): void {
    this.isPicking.set(false);
    const shown = this.shownIds();
    const fresh = assetIds.filter((id) => !shown.has(id));
    if (fresh.length === 0) {
      return;
    }
    this.addedAssetIds.update((current) => [...current, ...fresh]);
    this.selectedIds.update((current) => {
      const next = new Set(current);
      for (const id of fresh) {
        next.add(id);
      }
      return next;
    });
  }

  async create(): Promise<void> {
    const finalIds = this.displayAssetIds().filter((id) => this.selectedIds().has(id));
    if (this.isBusy() || finalIds.length === 0) {
      return;
    }
    const isEdited =
      this.addedAssetIds().length > 0 || finalIds.length !== this.suggestionAssetIds().length;
    const title = this.name().trim() || undefined;
    this.isBusy.set(true);
    try {
      await this.api.acceptSuggestion(this.suggestion().id, title, isEdited ? finalIds : undefined);
      this.decided.emit('created');
    } finally {
      this.isBusy.set(false);
    }
  }

  async dismiss(): Promise<void> {
    if (this.isBusy()) {
      return;
    }
    this.isBusy.set(true);
    try {
      await this.api.dismissSuggestion(this.suggestion().id);
      this.decided.emit('dismissed');
    } finally {
      this.isBusy.set(false);
    }
  }

  /** "Later" just clears it from this session's grid; it returns on next visit. */
  later(): void {
    this.decided.emit('later');
  }

  private async loadAssets(): Promise<void> {
    const { assetIds } = await this.api.getSuggestionAssets(this.suggestion().id);
    this.suggestionAssetIds.set(assetIds);
    this.selectedIds.set(new Set(assetIds));
  }
}
