import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MemoriesApiService } from '../../core/api/memories-api.service';
import { InboxSuggestion } from '../../core/api/api-models';
import { AuthStateService } from '../../core/auth/auth-state.service';
import { BottomNav } from '../../shared/bottom-nav';
import { AssetPicker } from '../../shared/asset-picker';

/**
 * The suggestion review flow: one suggestion at a time. Its photos start all
 * selected; the reviewer can deselect the ones that don't belong and add more
 * off the timeline before creating the Memory — or dismiss it as "not an event".
 */
@Component({
  selector: 'app-inbox-review-page',
  imports: [BottomNav, RouterLink, AssetPicker],
  templateUrl: './inbox-review-page.html',
  styleUrl: './inbox-review-page.scss',
})
export class InboxReviewPage implements OnInit {
  private readonly api = inject(MemoriesApiService);
  private readonly auth = inject(AuthStateService);

  readonly queue = signal<InboxSuggestion[]>([]);
  readonly isLoaded = signal(false);
  readonly isBusy = signal(false);
  readonly isPicking = signal(false);
  readonly reviewedCount = signal(0);

  /** The current suggestion's own photos, and any added off the timeline. */
  private readonly suggestionAssetIds = signal<string[]>([]);
  private readonly addedAssetIds = signal<string[]>([]);
  /** The photos currently checked for inclusion in the Memory. */
  readonly selectedIds = signal<ReadonlySet<string>>(new Set());

  readonly current = computed<InboxSuggestion | null>(() => this.queue()[0] ?? null);
  /** Suggestion photos first, then added ones — the order shown in the grid. */
  readonly displayAssetIds = computed<string[]>(() => [
    ...this.suggestionAssetIds(),
    ...this.addedAssetIds(),
  ]);
  readonly selectedCount = computed<number>(
    () => this.displayAssetIds().filter((id) => this.selectedIds().has(id)).length,
  );
  /** Already-shown photos, so the picker doesn't offer them again. */
  readonly shownIds = computed<ReadonlySet<string>>(() => new Set(this.displayAssetIds()));

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

  formatSpan(suggestion: InboxSuggestion): string {
    const start = new Date(suggestion.startAt);
    const end = new Date(suggestion.endAt);
    const day = new Intl.DateTimeFormat(undefined, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
    const time = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
    return start.toDateString() === end.toDateString()
      ? `${day.format(start)} · ${time.format(start)}–${time.format(end)}`
      : `${day.format(start)} – ${day.format(end)}`;
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

  /** Merges the picker's choices in as added, pre-selected photos. */
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

  async accept(): Promise<void> {
    const finalIds = this.displayAssetIds().filter((id) => this.selectedIds().has(id));
    if (finalIds.length === 0) {
      return;
    }
    // An untouched full selection uses the original path (server keeps the
    // suggestion's own span); any edit sends the explicit set.
    const isEdited =
      this.addedAssetIds().length > 0 || finalIds.length !== this.suggestionAssetIds().length;
    await this.decide((suggestion) =>
      this.api.acceptSuggestion(suggestion.id, undefined, isEdited ? finalIds : undefined).then(() => undefined),
    );
  }

  async dismiss(): Promise<void> {
    await this.decide((suggestion) => this.api.dismissSuggestion(suggestion.id));
  }

  /** Skip = decide later; the suggestion moves to the back of today's queue. */
  skip(): void {
    this.queue.update((queue) => (queue.length > 1 ? [...queue.slice(1), queue[0]] : queue));
    void this.loadCurrentSuggestion();
  }

  private async decide(action: (suggestion: InboxSuggestion) => Promise<void>): Promise<void> {
    const suggestion = this.current();
    if (!suggestion || this.isBusy()) {
      return;
    }
    this.isBusy.set(true);
    try {
      await action(suggestion);
      this.reviewedCount.update((count) => count + 1);
      this.queue.update((queue) => queue.slice(1));
      await this.loadCurrentSuggestion();
    } finally {
      this.isBusy.set(false);
    }
  }

  private async load(): Promise<void> {
    const { suggestions } = await this.api.listInbox();
    this.queue.set(suggestions);
    this.isLoaded.set(true);
    await this.loadCurrentSuggestion();
  }

  /** Loads the head suggestion's photos and resets the selection to all of them. */
  private async loadCurrentSuggestion(): Promise<void> {
    const suggestion = this.current();
    this.suggestionAssetIds.set([]);
    this.addedAssetIds.set([]);
    this.selectedIds.set(new Set());
    this.isPicking.set(false);
    if (!suggestion) {
      return;
    }
    const { assetIds } = await this.api.getSuggestionAssets(suggestion.id);
    if (this.current()?.id === suggestion.id) {
      this.suggestionAssetIds.set(assetIds);
      this.selectedIds.set(new Set(assetIds));
    }
  }
}
