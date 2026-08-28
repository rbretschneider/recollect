import { Component, inject, OnInit, signal } from '@angular/core';
import { assetThumbUrl } from '../../core/api/photos-api.service';
import { RouterLink } from '@angular/router';
import { TrashApiService, TrashItem } from '../../core/api/trash-api.service';
import { AccountBadge } from '../../shared/account-badge';
import { MenuButton } from '../../shared/menu-button';
import { BackButton } from '../../shared/back-button';
import { PageLoading } from '../../shared/page-loading';
import { LoadError } from '../../shared/load-error';
import { ToastService } from '../../shared/toast.service';

/** The Trash view: what's held, when it purges, and restore (S5.2/S5.3). */
@Component({
  selector: 'app-trash-page',
  imports: [AccountBadge, MenuButton, PageLoading, BackButton, RouterLink, LoadError],
  templateUrl: './trash-page.html',
  styleUrl: './trash-page.scss',
})
export class TrashPage implements OnInit {
  private readonly api = inject(TrashApiService);
  private readonly toasts = inject(ToastService);

  readonly items = signal<TrashItem[]>([]);
  readonly isLoaded = signal(false);
  readonly loadFailed = signal(false);
  /** Asset id currently being restored, so its button can't double-fire. */
  readonly restoringId = signal<string | null>(null);

  ngOnInit(): void {
    void this.reload();
  }

  thumbUrl(assetId: string): string {
    return assetThumbUrl(assetId);
  }

  daysUntilPurge(item: TrashItem): number {
    const remaining = new Date(item.purgeAt).getTime() - Date.now();
    return Math.max(0, Math.ceil(remaining / (24 * 60 * 60 * 1000)));
  }

  async restore(item: TrashItem): Promise<void> {
    if (this.restoringId() !== null) {
      return;
    }
    this.restoringId.set(item.assetId);
    try {
      // Await success BEFORE removing the row, so a failed restore leaves the
      // item exactly where it was instead of vanishing on a false success.
      await this.api.restoreAssets([item.assetId]);
      this.items.update((list) => list.filter((entry) => entry.assetId !== item.assetId));
      this.toasts.success(`Restored “${item.fileName}”`);
    } catch {
      this.toasts.error("Couldn't restore that photo.", {
        label: 'Retry',
        run: () => void this.restore(item),
      });
    } finally {
      this.restoringId.set(null);
    }
  }

  protected async reload(): Promise<void> {
    this.loadFailed.set(false);
    try {
      const { items } = await this.api.list();
      this.items.set(items);
      this.isLoaded.set(true);
    } catch {
      this.loadFailed.set(true);
    }
  }
}
