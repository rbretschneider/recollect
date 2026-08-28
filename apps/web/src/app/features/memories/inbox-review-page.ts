import { Component, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MemoriesApiService } from '../../core/api/memories-api.service';
import { InboxSuggestion } from '../../core/api/api-models';
import { AuthStateService } from '../../core/auth/auth-state.service';
import { MenuButton } from '../../shared/menu-button';
import { BackButton } from '../../shared/back-button';
import { BottomNav } from '../../shared/bottom-nav';
import { PageLoading } from '../../shared/page-loading';
import { ConfirmService } from '../../shared/confirm.service';
import { SuggestionCard, SuggestionOutcome } from './suggestion-card';

/**
 * The suggestion review grid: several suggestions shown at once, each its own
 * self-contained card (name, curate photos, Create / Not an event / Later).
 */
@Component({
  selector: 'app-inbox-review-page',
  imports: [MenuButton, PageLoading, BackButton, BottomNav, RouterLink, SuggestionCard],
  templateUrl: './inbox-review-page.html',
  styleUrl: './inbox-review-page.scss',
})
export class InboxReviewPage implements OnInit {
  private readonly api = inject(MemoriesApiService);
  private readonly auth = inject(AuthStateService);
  private readonly confirms = inject(ConfirmService);

  readonly queue = signal<InboxSuggestion[]>([]);
  readonly isLoaded = signal(false);
  readonly reviewedCount = signal(0);

  get canWrite(): boolean {
    const permission = this.auth.user()?.permission;
    return permission === 'write' || permission === 'delete';
  }

  ngOnInit(): void {
    void this.load();
  }

  /** A card decided itself: drop it from the grid; count real decisions only. */
  onDecided(suggestionId: string, outcome: SuggestionOutcome): void {
    this.queue.update((queue) => queue.filter((suggestion) => suggestion.id !== suggestionId));
    if (outcome !== 'later') {
      this.reviewedCount.update((count) => count + 1);
    }
  }

  /** Clears the whole inbox at once; dismissed suggestions never resurface. */
  async dismissAll(): Promise<void> {
    const count = this.queue().length;
    const confirmed = await this.confirms.ask({
      title: `Dismiss all ${count} suggestions?`,
      message:
        'The whole inbox clears and these exact suggestions never come back. Your photos are not affected, and new events will still be suggested.',
      confirmLabel: 'Dismiss all',
    });
    if (!confirmed) {
      return;
    }
    await this.api.dismissAllSuggestions();
    this.queue.set([]);
  }

  private async load(): Promise<void> {
    const { suggestions } = await this.api.listInbox();
    this.queue.set(suggestions);
    this.isLoaded.set(true);
  }
}
