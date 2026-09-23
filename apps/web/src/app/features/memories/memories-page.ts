import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { assetThumbUrl } from '../../core/api/photos-api.service';
import { formatDateSpan } from '../../core/format-date';
import { RouterLink } from '@angular/router';
import { LibraryApiService } from '../../core/api/library-api.service';
import { MemoriesApiService } from '../../core/api/memories-api.service';
import { LibraryStatus, MemorySummary } from '../../core/api/api-models';
import { AppTopbar } from '../../shared/app-topbar';
import { PageLoading } from '../../shared/page-loading';
import { LoadError } from '../../shared/load-error';
import { Icon } from '../../shared/icon';

/** Big browsing cards, or a compact spine you can skim years of. */
export type MemoriesView = 'cards' | 'timeline';

const VIEW_PREF_KEY = 'recollect.memoriesView';

function loadViewPref(): MemoriesView {
  try {
    return localStorage.getItem(VIEW_PREF_KEY) === 'timeline' ? 'timeline' : 'cards';
  } catch {
    return 'cards';
  }
}

/** The Memories tab: the timeline of confirmed memories; suggestions live on their own review page. */
@Component({
  selector: 'app-memories-page',
  imports: [PageLoading, AppTopbar, RouterLink, LoadError, Icon],
  templateUrl: './memories-page.html',
  styleUrl: './memories-page.scss',
})
export class MemoriesPage implements OnInit {
  private readonly api = inject(MemoriesApiService);
  private readonly libraryApi = inject(LibraryApiService);
  private readonly destroyRef = inject(DestroyRef);
  private statusTimer: ReturnType<typeof setInterval> | null = null;

  readonly memories = signal<MemorySummary[]>([]);
  readonly suggestionCount = signal(0);
  readonly isLoaded = signal(false);
  readonly loadFailed = signal(false);
  readonly status = signal<LibraryStatus | null>(null);
  /** Cards to browse, spine to find something — the choice sticks per device. */
  readonly view = signal<MemoriesView>(loadViewPref());

  readonly pendingCount = computed(() => {
    const status = this.status();
    return status ? status.queuedJobs + status.runningJobs : 0;
  });

  ngOnInit(): void {
    void this.reload();
    this.statusTimer = setInterval(() => void this.pollWhileIndexing(), 5000);
    this.destroyRef.onDestroy(() => {
      if (this.statusTimer !== null) {
        clearInterval(this.statusTimer);
      }
    });
  }

  coverUrl(memory: MemorySummary): string | null {
    return memory.coverAssetId ? assetThumbUrl(memory.coverAssetId, 720) : null;
  }

  /** The spine's thumbnails are small, so they take the small derivative too. */
  thumbUrl(memory: MemorySummary): string | null {
    return memory.coverAssetId ? assetThumbUrl(memory.coverAssetId, 240) : null;
  }

  formatSpan(memory: MemorySummary): string {
    return formatDateSpan(memory.startAt, memory.endAt);
  }

  /** "Sep 22" — the year is already the heading above the rung. */
  shortSpan(memory: MemorySummary): string {
    return new Date(memory.startAt).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    });
  }

  setView(view: MemoriesView): void {
    this.view.set(view);
    try {
      localStorage.setItem(VIEW_PREF_KEY, view);
    } catch {
      // Storage refused; the switch still works for this visit.
    }
  }

  yearOf(memory: MemorySummary): number {
    return new Date(memory.startAt).getFullYear();
  }

  isFirstOfYear(index: number): boolean {
    const list = this.memories();
    return index === 0 || this.yearOf(list[index]) !== this.yearOf(list[index - 1]);
  }

  protected async reload(): Promise<void> {
    this.loadFailed.set(false);
    try {
      const [inbox, memories] = await Promise.all([this.api.listInbox(), this.api.listMemories()]);
      this.suggestionCount.set(inbox.suggestions.length);
      this.memories.set(memories.memories);
      this.isLoaded.set(true);
    } catch {
      this.loadFailed.set(true);
    }
  }

  private async pollWhileIndexing(): Promise<void> {
    try {
      this.status.set(await this.libraryApi.getStatus());
    } catch {
      return;
    }
    if (this.pendingCount() > 0) {
      const { suggestions } = await this.api.listInbox();
      this.suggestionCount.set(suggestions.length);
    }
  }
}
