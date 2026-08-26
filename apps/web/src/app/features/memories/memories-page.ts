import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LibraryApiService } from '../../core/api/library-api.service';
import { MemoriesApiService } from '../../core/api/memories-api.service';
import { InboxSuggestion, LibraryStatus, MemorySummary } from '../../core/api/api-models';
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
  private readonly libraryApi = inject(LibraryApiService);
  private readonly auth = inject(AuthStateService);
  private readonly destroyRef = inject(DestroyRef);
  private statusTimer: ReturnType<typeof setInterval> | null = null;

  readonly suggestions = signal<InboxSuggestion[]>([]);
  readonly memories = signal<MemorySummary[]>([]);
  readonly isLoaded = signal(false);
  readonly busySuggestionId = signal<string | null>(null);
  readonly status = signal<LibraryStatus | null>(null);
  readonly expandedSuggestionId = signal<string | null>(null);
  readonly expandedAssetIds = signal<string[]>([]);

  readonly pendingCount = computed(() => {
    const status = this.status();
    return status ? status.queuedJobs + status.runningJobs : 0;
  });

  /** Read-only users see the timeline but no accept/dismiss actions. */
  get canWrite(): boolean {
    const permission = this.auth.user()?.permission;
    return permission === 'write' || permission === 'delete';
  }

  ngOnInit(): void {
    void this.reload();
    void this.pollWhileIndexing();
    this.statusTimer = setInterval(() => void this.pollWhileIndexing(), 5000);
    this.destroyRef.onDestroy(() => {
      if (this.statusTimer !== null) {
        clearInterval(this.statusTimer);
      }
    });
  }

  thumbUrl(assetId: string): string {
    return `/api/v1/assets/${assetId}/thumb/240`;
  }

  coverUrl(memory: MemorySummary): string | null {
    return memory.coverAssetId ? `/api/v1/assets/${memory.coverAssetId}/thumb/720` : null;
  }

  /** Tap a suggestion to see exactly which photos it groups before deciding. */
  async toggleExpanded(suggestion: InboxSuggestion): Promise<void> {
    if (this.expandedSuggestionId() === suggestion.id) {
      this.expandedSuggestionId.set(null);
      return;
    }
    this.expandedSuggestionId.set(suggestion.id);
    this.expandedAssetIds.set([]);
    const { assetIds } = await this.api.getSuggestionAssets(suggestion.id);
    if (this.expandedSuggestionId() === suggestion.id) {
      this.expandedAssetIds.set(assetIds);
    }
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

  /** While indexing runs, keep the page live: fresh suggestions surface as found. */
  private async pollWhileIndexing(): Promise<void> {
    try {
      this.status.set(await this.libraryApi.getStatus());
    } catch {
      return;
    }
    if (this.pendingCount() > 0) {
      const { suggestions } = await this.api.listInbox();
      this.suggestions.set(suggestions);
    }
  }
}
