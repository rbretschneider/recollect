import { Component, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MemoriesApiService } from '../../core/api/memories-api.service';
import { InboxSuggestion } from '../../core/api/api-models';
import { AuthStateService } from '../../core/auth/auth-state.service';
import { BottomNav } from '../../shared/bottom-nav';
import { SuggestionCard, SuggestionOutcome } from './suggestion-card';

/**
 * The suggestion review grid: several suggestions shown at once, each its own
 * self-contained card (name, curate photos, Create / Not an event / Later).
 */
@Component({
  selector: 'app-inbox-review-page',
  imports: [BottomNav, RouterLink, SuggestionCard],
  templateUrl: './inbox-review-page.html',
  styleUrl: './inbox-review-page.scss',
})
export class InboxReviewPage implements OnInit {
  private readonly api = inject(MemoriesApiService);
  private readonly auth = inject(AuthStateService);

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

  private async load(): Promise<void> {
    const { suggestions } = await this.api.listInbox();
    this.queue.set(suggestions);
    this.isLoaded.set(true);
  }
}
