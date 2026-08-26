import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { MemoriesApiService } from '../../core/api/memories-api.service';
import { MemoryDetail, TimelineAsset } from '../../core/api/api-models';
import { AuthStateService } from '../../core/auth/auth-state.service';
import { BottomNav } from '../../shared/bottom-nav';
import { ShareButton } from '../../shared/share-button';
import { AssetViewer } from '../viewer/asset-viewer';

const JOURNAL_AUTOSAVE_MS = 1500;

/** One Memory: hero, editable title, media grid, and the journal. */
@Component({
  selector: 'app-memory-detail-page',
  imports: [AssetViewer, BottomNav, FormsModule, RouterLink, ShareButton],
  templateUrl: './memory-detail-page.html',
  styleUrl: './memory-detail-page.scss',
})
export class MemoryDetailPage implements OnInit {
  private readonly api = inject(MemoriesApiService);
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly auth = inject(AuthStateService);
  private readonly destroyRef = inject(DestroyRef);

  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  readonly detail = signal<MemoryDetail | null>(null);
  readonly viewerAssets = signal<TimelineAsset[]>([]);
  readonly viewerIndex = signal<number | null>(null);
  readonly isEditingTitle = signal(false);
  readonly journalDraft = signal('');
  readonly saveState = signal<'idle' | 'saving' | 'saved'>('idle');

  titleDraft = '';

  readonly myJournalEntry = computed(() => {
    const userId = this.auth.user()?.id;
    return this.detail()?.journal.find((entry) => entry.authorUserId === userId) ?? null;
  });

  readonly othersJournalEntries = computed(() => {
    const userId = this.auth.user()?.id;
    return this.detail()?.journal.filter((entry) => entry.authorUserId !== userId) ?? [];
  });

  get canWrite(): boolean {
    const permission = this.auth.user()?.permission;
    return permission === 'write' || permission === 'delete';
  }

  ngOnInit(): void {
    this.destroyRef.onDestroy(() => this.flushJournalSave());
    void this.load();
  }

  thumbUrl(assetId: string): string {
    return `/api/v1/assets/${assetId}/thumb/240`;
  }

  coverUrl(detail: MemoryDetail): string | null {
    return detail.coverAssetId ? `/api/v1/assets/${detail.coverAssetId}/thumb/1440` : null;
  }

  formatSpan(detail: MemoryDetail): string {
    const start = new Date(detail.startAt);
    const end = new Date(detail.endAt);
    const format = new Intl.DateTimeFormat(undefined, {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
    return start.toDateString() === end.toDateString()
      ? format.format(start)
      : `${format.format(start)} – ${format.format(end)}`;
  }

  startEditingTitle(): void {
    if (!this.canWrite) {
      return;
    }
    this.titleDraft = this.detail()?.title ?? '';
    this.isEditingTitle.set(true);
  }

  async saveTitle(): Promise<void> {
    const detail = this.detail();
    const title = this.titleDraft.trim();
    this.isEditingTitle.set(false);
    if (!detail || title.length === 0 || title === detail.title) {
      return;
    }
    this.detail.set({ ...detail, title });
    await this.api.updateMemory(detail.id, { title });
  }

  onJournalInput(value: string): void {
    this.journalDraft.set(value);
    this.saveState.set('saving');
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
    }
    this.saveTimer = setTimeout(() => void this.saveJournal(), JOURNAL_AUTOSAVE_MS);
  }

  async openViewer(assetId: string): Promise<void> {
    const detail = this.detail();
    if (!detail) {
      return;
    }
    if (this.viewerAssets().length === 0) {
      await this.loadViewerAssets(detail.assetIds);
    }
    const index = this.viewerAssets().findIndex((asset) => asset.id === assetId);
    if (index >= 0) {
      this.viewerIndex.set(index);
    }
  }

  closeViewer(): void {
    this.viewerIndex.set(null);
  }

  private async load(): Promise<void> {
    const memoryId = this.route.snapshot.paramMap.get('id');
    if (!memoryId) {
      return;
    }
    const detail = await this.api.getMemory(memoryId);
    this.detail.set(detail);
    this.journalDraft.set(
      detail.journal.find((entry) => entry.authorUserId === this.auth.user()?.id)?.bodyMd ?? '',
    );
  }

  private async saveJournal(): Promise<void> {
    const detail = this.detail();
    if (!detail) {
      return;
    }
    await this.api.writeJournal(detail.id, this.journalDraft());
    this.saveState.set('saved');
  }

  private flushJournalSave(): void {
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
      void this.saveJournal();
    }
  }

  /** The viewer needs TimelineAsset shapes; fetch details for the memory's assets. */
  private async loadViewerAssets(assetIds: string[]): Promise<void> {
    const assets: TimelineAsset[] = [];
    for (const id of assetIds) {
      try {
        const detail = await firstValueFrom(
          this.http.get<{
            id: string;
            mediaType: 'image' | 'video';
            capturedAt: string;
            width: number | null;
            height: number | null;
            durationMs: number | null;
          }>(`/api/v1/assets/${id}/detail`),
        );
        assets.push({ ...detail, capturedDay: detail.capturedAt.slice(0, 10), hasThumbnail: true });
      } catch {
        // Missing assets render as tombstones; skip them in the viewer.
      }
    }
    this.viewerAssets.set(assets);
  }
}
