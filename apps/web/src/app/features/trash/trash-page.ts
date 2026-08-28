import { Component, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TrashApiService, TrashItem } from '../../core/api/trash-api.service';
import { AccountBadge } from '../../shared/account-badge';
import { MenuButton } from '../../shared/menu-button';
import { BackButton } from '../../shared/back-button';
import { BottomNav } from '../../shared/bottom-nav';
import { PageLoading } from '../../shared/page-loading';

/** The Trash view: what's held, when it purges, and restore (S5.2/S5.3). */
@Component({
  selector: 'app-trash-page',
  imports: [AccountBadge, MenuButton, PageLoading, BackButton, BottomNav, RouterLink],
  templateUrl: './trash-page.html',
  styleUrl: './trash-page.scss',
})
export class TrashPage implements OnInit {
  private readonly api = inject(TrashApiService);

  readonly items = signal<TrashItem[]>([]);
  readonly isLoaded = signal(false);

  ngOnInit(): void {
    void this.reload();
  }

  thumbUrl(assetId: string): string {
    return `/api/v1/assets/${assetId}/thumb/240`;
  }

  daysUntilPurge(item: TrashItem): number {
    const remaining = new Date(item.purgeAt).getTime() - Date.now();
    return Math.max(0, Math.ceil(remaining / (24 * 60 * 60 * 1000)));
  }

  async restore(item: TrashItem): Promise<void> {
    await this.api.restoreAssets([item.assetId]);
    this.items.update((list) => list.filter((entry) => entry.assetId !== item.assetId));
  }

  private async reload(): Promise<void> {
    const { items } = await this.api.list();
    this.items.set(items);
    this.isLoaded.set(true);
  }
}
