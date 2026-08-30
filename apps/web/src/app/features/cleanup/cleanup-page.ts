import { Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { assetThumbUrl } from '../../core/api/photos-api.service';
import { formatBytes } from '../../core/format-date';
import {
  CleanupApiService,
  CleanupSuggestions,
  ConvertedOriginal,
  JunkSuggestion,
  SpaceHogSuggestion,
} from '../../core/api/cleanup-api.service';
import { TimelineAsset, toViewerAsset } from '../../core/api/api-models';
import { TrashApiService } from '../../core/api/trash-api.service';
import { FormsModule } from '@angular/forms';
import { AccountBadge } from '../../shared/account-badge';
import { Sheet } from '../../shared/sheet';
import { BackButton } from '../../shared/back-button';
import { ConfirmService } from '../../shared/confirm.service';
import { MenuButton } from '../../shared/menu-button';
import { PageLoading } from '../../shared/page-loading';
import { LoadError } from '../../shared/load-error';
import { ToastService } from '../../shared/toast.service';
import { AssetViewer } from '../viewer/asset-viewer';

/**
 * The cleanup advisor: reclaim NAS space. Junk flags go to Trash (normal
 * holding period), space hogs offer in-place conversion (the original waits
 * out the retention window as the undo). Nothing is ever auto-deleted.
 */
@Component({
  selector: 'app-cleanup-page',
  imports: [AccountBadge, BackButton, FormsModule, MenuButton, PageLoading, Sheet, LoadError, AssetViewer],
  templateUrl: './cleanup-page.html',
  styleUrl: './cleanup-page.scss',
})
export class CleanupPage implements OnInit, OnDestroy {
  private readonly api = inject(CleanupApiService);
  private readonly trashApi = inject(TrashApiService);
  private readonly confirms = inject(ConfirmService);
  private readonly toasts = inject(ToastService);

  readonly data = signal<CleanupSuggestions | null>(null);
  readonly loadFailed = signal(false);
  readonly isBusy = signal(false);
  /** True while a convert request is in flight, so Convert can't double-fire. */
  readonly isConverting = signal(false);
  /** Asset ids whose conversion was queued this visit (instant feedback). */
  readonly queuedConversions = signal<ReadonlySet<string>>(new Set());

  /** Open index into flaggedAssets for the full-screen verify viewer. */
  readonly viewerIndex = signal<number | null>(null);

  /**
   * Every flagged item as a viewer asset, so a tap opens it full-screen (with
   * zoom, video playback, and the info/delete panel) to verify before removing.
   * Order matches the page: junk, then hogs, then converted originals.
   */
  readonly flaggedAssets = computed<TimelineAsset[]>(() => {
    const suggestions = this.data();
    const placeholderDate = new Date(0).toISOString();
    const items: TimelineAsset[] = [];
    for (const junk of suggestions?.junk ?? []) {
      items.push(toViewerAsset(junk.assetId, junk.mediaType === 'video' ? 'video' : 'image', placeholderDate));
    }
    for (const hog of suggestions?.hogs ?? []) {
      items.push(toViewerAsset(hog.assetId, hog.mediaType === 'video' ? 'video' : 'image', placeholderDate));
    }
    for (const original of this.convertedOriginals()) {
      items.push(toViewerAsset(original.assetId, 'video', placeholderDate));
    }
    return items;
  });

  openViewer(assetId: string): void {
    const index = this.flaggedAssets().findIndex((asset) => asset.id === assetId);
    if (index >= 0) {
      this.viewerIndex.set(index);
    }
  }

  closeViewer(): void {
    this.viewerIndex.set(null);
  }

  ngOnInit(): void {
    void this.load();
  }

  ngOnDestroy(): void {
    this.stopPolling();
  }

  thumbUrl(assetId: string): string {
    return assetThumbUrl(assetId);
  }

  formatSize(bytes: number): string {
    return formatBytes(bytes);
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
    try {
      await this.trashApi.trashAssets([item.assetId]);
      this.removeJunk(item.assetId);
      this.toasts.success(`Moved “${item.fileName}” to Trash`);
    } catch {
      this.toasts.error("Couldn't move that to Trash.", {
        label: 'Retry',
        run: () => void this.trashJunk(item),
      });
    }
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
    // Await the dismissal BEFORE dropping the row, so a failed call leaves the
    // suggestion in place rather than flashing a false "kept".
    try {
      await this.api.dismiss([item.assetId]);
      this.removeJunk(item.assetId);
    } catch {
      this.toasts.error("Couldn't dismiss that suggestion.", {
        label: 'Retry',
        run: () => void this.dismissJunk(item),
      });
    }
  }

  async dismissHog(item: SpaceHogSuggestion): Promise<void> {
    try {
      await this.api.dismiss([item.assetId]);
      const data = this.data();
      if (data) {
        this.data.set({ ...data, hogs: data.hogs.filter((hog) => hog.assetId !== item.assetId) });
      }
    } catch {
      this.toasts.error("Couldn't dismiss that suggestion.", {
        label: 'Retry',
        run: () => void this.dismissHog(item),
      });
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
    if (!item || this.isConverting()) {
      return;
    }
    this.isConverting.set(true);
    try {
      // Await the queue call before showing "Converting…" or closing the sheet,
      // so a double-tap can't queue duplicate conversions and a failure is seen.
      await this.api.convert(item.assetId, this.convertCodec);
      this.queuedConversions.update((set) => new Set([...set, item.assetId]));
      this.convertTarget.set(null);
      this.toasts.success(`Converting “${item.fileName}” — this runs in the background and can take a while.`);
    } catch {
      this.toasts.error("Couldn't start that conversion.");
    } finally {
      this.isConverting.set(false);
    }
  }

  /** Originals slated for deletion after conversion (the visible undo). */
  readonly convertedOriginals = signal<ConvertedOriginal[]>([]);
  /** Assets with a restore in flight — a big cross-volume copy runs in the background. */
  readonly restoringIds = signal<ReadonlySet<string>>(new Set());
  private readonly restoreNames = new Map<string, string>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  deletesAtLabel(iso: string): string {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  isRestoring(original: ConvertedOriginal): boolean {
    return original.restoring || this.restoringIds().has(original.assetId);
  }

  async restoreOriginal(assetId: string): Promise<void> {
    if (this.restoringIds().has(assetId)) {
      return;
    }
    const name = this.convertedOriginals().find((o) => o.assetId === assetId)?.fileName ?? 'the original';
    this.restoreNames.set(assetId, name);
    this.restoringIds.update((set) => new Set([...set, assetId]));
    try {
      // Enqueues a background job — the copy is far too big to await in-request.
      await this.api.restore(assetId);
      this.toasts.success(
        `Restoring “${name}” — this runs in the background and can take a while.`,
      );
      this.startPolling();
      await this.load();
    } catch {
      this.restoringIds.update((set) => {
        const next = new Set(set);
        next.delete(assetId);
        return next;
      });
      this.toasts.error(`Couldn’t start restoring “${name}”.`, {
        label: 'Retry',
        run: () => void this.restoreOriginal(assetId),
      });
    }
  }

  private startPolling(): void {
    if (!this.pollTimer) {
      this.pollTimer = setInterval(() => void this.load(), 4000);
    }
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /**
   * Reconcile the in-flight restore set against a fresh listing: an original
   * that has vanished finished restoring (toast the win); the server's own
   * "restoring" flag then drives the live chip so a page reload still shows it.
   */
  private reconcileRestoring(originals: ConvertedOriginal[]): void {
    const present = new Set(originals.map((o) => o.assetId));
    const next = new Set<string>();
    for (const id of this.restoringIds()) {
      if (!present.has(id)) {
        this.toasts.success(`Restored “${this.restoreNames.get(id) ?? 'the original'}”`);
        this.restoreNames.delete(id);
      } else if (!originals.find((o) => o.assetId === id)?.restoring) {
        // Still parked and the server isn't yet reporting the job — hold the
        // optimistic chip until the server takes over (or the job clears).
        next.add(id);
      }
    }
    for (const original of originals) {
      if (original.restoring) {
        next.add(original.assetId);
      }
    }
    this.restoringIds.set(next);
    if (next.size === 0) {
      this.stopPolling();
    } else {
      this.startPolling();
    }
  }

  private removeJunk(assetId: string): void {
    const data = this.data();
    if (data) {
      this.data.set({ ...data, junk: data.junk.filter((item) => item.assetId !== assetId) });
    }
  }

  protected async load(): Promise<void> {
    this.loadFailed.set(false);
    try {
      const [suggestions, converted] = await Promise.all([
        this.api.suggestions(),
        this.api.listConverted().catch(() => ({ originals: [] })),
      ]);
      this.data.set(suggestions);
      this.convertedOriginals.set(converted.originals);
      this.reconcileRestoring(converted.originals);
    } catch {
      this.loadFailed.set(true);
    }
  }
}
