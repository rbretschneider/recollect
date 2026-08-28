import { Component, inject, OnInit, signal } from '@angular/core';
import {
  CleanupApiService,
  CleanupSuggestions,
  JunkSuggestion,
  SpaceHogSuggestion,
} from '../../core/api/cleanup-api.service';
import { TrashApiService } from '../../core/api/trash-api.service';
import { AccountBadge } from '../../shared/account-badge';
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
  imports: [AccountBadge, BackButton, MenuButton, PageLoading],
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

  async convert(item: SpaceHogSuggestion): Promise<void> {
    const confirmed = await this.confirms.ask({
      title: `Convert “${item.fileName}”?`,
      message: `Re-encodes it to an efficient format and REPLACES the file on disk (est. ${this.formatSize(item.estimatedBytes ?? 0)} instead of ${this.formatSize(item.sizeBytes)}). The original is kept for the Trash holding period as the undo. If conversion barely helps, the original is kept automatically.`,
      confirmLabel: 'Convert & replace',
    });
    if (!confirmed) {
      return;
    }
    await this.api.convert(item.assetId);
    this.queuedConversions.update((set) => new Set([...set, item.assetId]));
  }

  private removeJunk(assetId: string): void {
    const data = this.data();
    if (data) {
      this.data.set({ ...data, junk: data.junk.filter((item) => item.assetId !== assetId) });
    }
  }

  private async load(): Promise<void> {
    this.data.set(await this.api.suggestions());
  }
}
