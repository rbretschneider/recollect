import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MemoriesApiService } from '../../core/api/memories-api.service';
import { InboxSuggestion } from '../../core/api/api-models';
import { AuthStateService } from '../../core/auth/auth-state.service';
import { BottomNav } from '../../shared/bottom-nav';

/**
 * The suggestion review flow: one suggestion at a time — Create or
 * "Not an event" — then the next appears. Built for inboxes with
 * hundreds of candidates; deciding is one tap each.
 */
@Component({
  selector: 'app-inbox-review-page',
  imports: [BottomNav, RouterLink],
  templateUrl: './inbox-review-page.html',
  styleUrl: './inbox-review-page.scss',
})
export class InboxReviewPage implements OnInit {
  private readonly api = inject(MemoriesApiService);
  private readonly auth = inject(AuthStateService);

  readonly queue = signal<InboxSuggestion[]>([]);
  readonly currentAssetIds = signal<string[]>([]);
  readonly isLoaded = signal(false);
  readonly isBusy = signal(false);
  readonly reviewedCount = signal(0);

  readonly current = computed<InboxSuggestion | null>(() => this.queue()[0] ?? null);

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

  async accept(): Promise<void> {
    await this.decide((suggestion) => this.api.acceptSuggestion(suggestion.id).then(() => undefined));
  }

  async dismiss(): Promise<void> {
    await this.decide((suggestion) => this.api.dismissSuggestion(suggestion.id));
  }

  /** Skip = decide later; the suggestion moves to the back of today's queue. */
  skip(): void {
    this.queue.update((queue) => (queue.length > 1 ? [...queue.slice(1), queue[0]] : queue));
    void this.loadCurrentAssets();
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
      await this.loadCurrentAssets();
    } finally {
      this.isBusy.set(false);
    }
  }

  private async load(): Promise<void> {
    const { suggestions } = await this.api.listInbox();
    this.queue.set(suggestions);
    this.isLoaded.set(true);
    await this.loadCurrentAssets();
  }

  private async loadCurrentAssets(): Promise<void> {
    const suggestion = this.current();
    this.currentAssetIds.set([]);
    if (suggestion) {
      const { assetIds } = await this.api.getSuggestionAssets(suggestion.id);
      if (this.current()?.id === suggestion.id) {
        this.currentAssetIds.set(assetIds);
      }
    }
  }
}
