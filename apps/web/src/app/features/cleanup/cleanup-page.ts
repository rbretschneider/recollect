import { Component, inject, OnInit, signal } from '@angular/core';
import {
  CleanupApiService,
  CleanupSuggestions,
  JunkSuggestion,
  SpaceHogSuggestion,
} from '../../core/api/cleanup-api.service';
import { TrashApiService } from '../../core/api/trash-api.service';
import { FormsModule } from '@angular/forms';
import { AccountBadge } from '../../shared/account-badge';
import { Sheet } from '../../shared/sheet';
import { BackButton } from '../../shared/back-button';
import { ConfirmService } from '../../shared/confirm.service';
import { MenuButton } from '../../shared/menu-button';
import { PageLoading } from '../../shared/page-loading';

/**
 * The cleanup advisor: reclaim NAS space. Junk flags go to Trash (normal
 * holding period), space hogs offer in-place conversion (the original waits
 * out the retention window as the undo). Nothing is ever auto-deleted.
 */
@Component({
  selector: 'app-cleanup-page',
  imports: [AccountBadge, BackButton, FormsModule, MenuButton, PageLoading, Sheet],
  templateUrl: './cleanup-page.html',
  styleUrl: './cleanup-page.scss',
})
export class CleanupPage implements OnInit {
  private readonly api = inject(CleanupApiService);
  private readonly trashApi = inject(TrashApiService);
  private readonly confirms = inject(ConfirmService);

  readonly data = signal<CleanupSuggestions | null>(null);
  readonly isBusy = signal(false);
  /** Asset ids whose conversion was queued this visit (instant feedback). */
  readonly queuedConversions = signal<ReadonlySet<string>>(new Set());

  ngOnInit(): void {
    void this.load();
  }

  thumbUrl(assetId: string): string {
    return `/api/v1/assets/${assetId}/thumb/240`;
  }

  formatSize(bytes: number): string {
    if (bytes >= 1024 ** 3) {
      return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
    }
    if (bytes >= 1024 ** 2) {
      return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
    }
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  formatBitrate(bitsPerSecond: number | null): string {
    return bitsPerSecond === null ? '' : `${(bitsPerSecond / 1_000_000).toFixed(0)} Mbps`;
  }

  savings(item: SpaceHogSuggestion): string {
    if (item.estimatedBytes === null) {
      return '';
    }
    return this.formatSize(Math.max(0, item.sizeBytes - item.estimatedBytes));
  }

  isQueued(item: SpaceHogSuggestion): boolean {
    return item.converting || this.queuedConversions().has(item.assetId);
  }

  async trashJunk(item: JunkSuggestion): Promise<void> {
    const confirmed = await this.confirms.ask({
      title: `Move “${item.fileName}” to Trash?`,
      message: `${item.reason}. The normal Trash holding period applies — restore any time before it empties.`,
      confirmLabel: 'Move to Trash',
    });
    if (!confirmed) {
      return;
    }
    await this.trashApi.trashAssets([item.assetId]);
    this.removeJunk(item.assetId);
  }

  async trashAllJunk(): Promise<void> {
    const items = this.data()?.junk ?? [];
    if (items.length === 0) {
      return;
    }
    const confirmed = await this.confirms.ask({
      title: `Move all ${items.length} to Trash?`,
      message:
        'Everything flagged here goes to Trash together. The normal holding period applies — restore any time before it empties.',
      confirmLabel: `Trash all ${items.length}`,
    });
    if (!confirmed) {
      return;
    }
    this.isBusy.set(true);
    try {
      await this.trashApi.trashAssets(items.map((item) => item.assetId));
      await this.load();
    } finally {
      this.isBusy.set(false);
    }
  }

  async dismissJunk(item: JunkSuggestion): Promise<void> {
    await this.api.dismiss([item.assetId]);
    this.removeJunk(item.assetId);
  }

  async dismissHog(item: SpaceHogSuggestion): Promise<void> {
    await this.api.dismiss([item.assetId]);
    const data = this.data();
    if (data) {
      this.data.set({ ...data, hogs: data.hogs.filter((hog) => hog.assetId !== item.assetId) });
    }
  }

  /** The hog whose conversion options sheet is open. */
  readonly convertTarget = signal<SpaceHogSuggestion | null>(null);
  convertCodec: 'hevc' | 'h264' = 'hevc';

  openConvert(item: SpaceHogSuggestion): void {
    this.convertCodec = 'hevc';
    this.convertTarget.set(item);
  }

  async confirmConvert(): Promise<void> {
    const item = this.convertTarget();
    if (!item) {
      return;
    }
    await this.api.convert(item.assetId, this.convertCodec);
    this.queuedConversions.update((set) => new Set([...set, item.assetId]));
    this.convertTarget.set(null);
  }

  /** Originals slated for deletion after conversion (the visible undo). */
  readonly convertedOriginals = signal<
    Array<{ assetId: string; fileName: string; sizeBytes: number; deletesAt: string }>
  >([]);
  readonly restoringId = signal<string | null>(null);

  deletesAtLabel(iso: string): string {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  async restoreOriginal(assetId: string): Promise<void> {
    this.restoringId.set(assetId);
    try {
      await this.api.restore(assetId);
      await this.load();
    } finally {
      this.restoringId.set(null);
    }
  }

  private removeJunk(assetId: string): void {
    const data = this.data();
    if (data) {
      this.data.set({ ...data, junk: data.junk.filter((item) => item.assetId !== assetId) });
    }
  }

  private async load(): Promise<void> {
    const [suggestions, converted] = await Promise.all([
      this.api.suggestions(),
      this.api.listConverted().catch(() => ({ originals: [] })),
    ]);
    this.data.set(suggestions);
    this.convertedOriginals.set(converted.originals);
  }
}
