import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { MemoriesApiService } from '../../core/api/memories-api.service';
import { InboxSuggestion, MemorySummary, TimelineAsset } from '../../core/api/api-models';
import { AuthStateService } from '../../core/auth/auth-state.service';
import { AppTopbar } from '../../shared/app-topbar';
import { AssetViewer } from '../viewer/asset-viewer';

interface OnThisDayYear {
  year: number;
  assetIds: string[];
}

/**
 * Home. The first screen after sign-in: on-this-day through the years,
 * fresh memory suggestions, and the latest memories to jump back into.
 */
@Component({
  selector: 'app-dashboard-page',
  imports: [AppTopbar, AssetViewer, RouterLink],
  templateUrl: './dashboard-page.html',
  styleUrl: './dashboard-page.scss',
})
export class DashboardPage implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly memoriesApi = inject(MemoriesApiService);
  private readonly auth = inject(AuthStateService);

  readonly onThisDay = signal<OnThisDayYear[]>([]);
  readonly suggestions = signal<InboxSuggestion[]>([]);
  readonly recentMemories = signal<MemorySummary[]>([]);
  readonly isLoaded = signal(false);

  /** Viewer over one year's strip. */
  readonly viewerAssets = signal<TimelineAsset[]>([]);
  readonly viewerIndex = signal<number | null>(null);

  readonly todayLabel = new Date().toLocaleDateString(undefined, {
    month: 'long',
    day: 'numeric',
  });

  readonly greeting = computed(() => {
    const name = this.auth.user()?.displayName.split(' ')[0] ?? '';
    const hour = new Date().getHours();
    const part = hour < 5 ? 'night owl' : hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
    return part === 'night owl' ? `Up late, ${name}?` : `Good ${part}, ${name}`;
  });

  ngOnInit(): void {
    void this.load();
  }

  thumbUrl(assetId: string, size: 240 | 720 = 240): string {
    return `/api/v1/assets/${assetId}/thumb/${size}`;
  }

  yearsAgo(year: number): string {
    const diff = new Date().getFullYear() - year;
    if (diff === 0) {
      return 'Today';
    }
    return diff === 1 ? 'A year ago' : `${diff} years ago`;
  }

  spanLabel(item: InboxSuggestion | MemorySummary): string {
    const start = new Date(item.startAt);
    return start.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  async openViewer(yearGroup: OnThisDayYear, assetId: string): Promise<void> {
    const { items } = await firstValueFrom(
      this.http.post<{ items: TimelineAsset[] }>('/api/v1/assets/items', {
        assetIds: yearGroup.assetIds,
      }),
    );
    this.viewerAssets.set(items);
    const index = items.findIndex((item) => item.id === assetId);
    this.viewerIndex.set(index >= 0 ? index : 0);
  }

  closeViewer(): void {
    this.viewerIndex.set(null);
  }

  onViewerDeleted(assetId: string): void {
    this.viewerAssets.update((assets) => assets.filter((asset) => asset.id !== assetId));
    this.onThisDay.update((years) =>
      years.map((group) => ({
        ...group,
        assetIds: group.assetIds.filter((id) => id !== assetId),
      })),
    );
  }

  private async load(): Promise<void> {
    const now = new Date();
    const day = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const [otd, inbox, memories] = await Promise.all([
      firstValueFrom(
        this.http.get<{ years: OnThisDayYear[] }>(`/api/v1/dashboard/on-this-day?day=${day}`),
      ).catch(() => ({ years: [] })),
      this.memoriesApi.listInbox().catch(() => ({ suggestions: [] })),
      this.memoriesApi.listMemories().catch(() => ({ memories: [] })),
    ]);
    // "Today" itself isn't a memory yet; show past years only.
    this.onThisDay.set(otd.years.filter((group) => group.year !== now.getFullYear()));
    this.suggestions.set(inbox.suggestions.slice(0, 4));
    this.recentMemories.set(memories.memories.slice(0, 4));
    this.isLoaded.set(true);
  }
}
