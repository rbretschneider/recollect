import { Component, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MemoriesApiService } from '../../core/api/memories-api.service';
import { InboxSuggestion, MemorySummary } from '../../core/api/api-models';
import { AuthStateService } from '../../core/auth/auth-state.service';
import { BottomNav } from '../../shared/bottom-nav';

/** The Memories tab: suggestion inbox on top, confirmed Memory timeline below. */
@Component({
  selector: 'app-memories-page',
  imports: [BottomNav, RouterLink],
  templateUrl: './memories-page.html',
  styleUrl: './memories-page.scss',
})
export class MemoriesPage implements OnInit {
  private readonly api = inject(MemoriesApiService);
  private readonly auth = inject(AuthStateService);

  readonly suggestions = signal<InboxSuggestion[]>([]);
  readonly memories = signal<MemorySummary[]>([]);
  readonly isLoaded = signal(false);
  readonly busySuggestionId = signal<string | null>(null);

  /** Read-only users see the timeline but no accept/dismiss actions. */
  get canWrite(): boolean {
    const permission = this.auth.user()?.permission;
    return permission === 'write' || permission === 'delete';
  }

  ngOnInit(): void {
    void this.reload();
  }

  thumbUrl(assetId: string): string {
    return `/api/v1/assets/${assetId}/thumb/240`;
  }

  coverUrl(memory: MemorySummary): string | null {
    return memory.coverAssetId ? `/api/v1/assets/${memory.coverAssetId}/thumb/720` : null;
  }

  async accept(suggestion: InboxSuggestion): Promise<void> {
    this.busySuggestionId.set(suggestion.id);
    try {
      await this.api.acceptSuggestion(suggestion.id);
      await this.reload();
    } finally {
      this.busySuggestionId.set(null);
    }
  }

  async dismiss(suggestion: InboxSuggestion): Promise<void> {
    this.busySuggestionId.set(suggestion.id);
    try {
      await this.api.dismissSuggestion(suggestion.id);
      this.suggestions.update((list) => list.filter((item) => item.id !== suggestion.id));
    } finally {
      this.busySuggestionId.set(null);
    }
  }

  formatSpan(memoryOrSuggestion: { startAt: string; endAt: string }): string {
    const start = new Date(memoryOrSuggestion.startAt);
    const end = new Date(memoryOrSuggestion.endAt);
    const sameDay = start.toDateString() === end.toDateString();
    const dayFormat = new Intl.DateTimeFormat(undefined, {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
    if (sameDay) {
      return dayFormat.format(start);
    }
    return `${dayFormat.format(start)} – ${dayFormat.format(end)}`;
  }

  yearOf(memory: MemorySummary): number {
    return new Date(memory.startAt).getFullYear();
  }

  isFirstOfYear(index: number): boolean {
    const list = this.memories();
    return index === 0 || this.yearOf(list[index]) !== this.yearOf(list[index - 1]);
  }

  private async reload(): Promise<void> {
    const [inbox, memories] = await Promise.all([this.api.listInbox(), this.api.listMemories()]);
    this.suggestions.set(inbox.suggestions);
    this.memories.set(memories.memories);
    this.isLoaded.set(true);
  }
}
