import { Component, computed, DestroyRef, effect, ElementRef, inject, input, output, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AssetDetailApiService } from '../../core/api/asset-detail-api.service';
import { AssetDetail, TimelineAsset } from '../../core/api/api-models';
import { PhotosApiService } from '../../core/api/photos-api.service';
import { AuthStateService } from '../../core/auth/auth-state.service';
import { describeError } from '../../core/describe-error';
import { formatCapturedDate } from '../../core/format-date';
import { toLocalInputValue } from '../../core/local-input';
import { Icon } from '../../shared/icon';
import { ToastService } from '../../shared/toast.service';

/** How often a queued reprocess is checked for completion. */
const REPROCESS_POLL_MS = 3000;

/** A reprocess that has not landed after this long is left to the user to retry. */
const REPROCESS_GIVE_UP_MS = 60_000;

/** Files smaller than this are almost never real photos (cloud-only stubs). */
const SUSPICIOUS_SIZE_BYTES = 16 * 1024;

type ReprocessState = 'idle' | 'running' | 'done';

/**
 * The photo details panel: title, capture date, file facts, place and
 * processing health for one item. Shared by the asset viewer and the
 * slideshow so both show exactly the same thing.
 *
 * The host owns loading: it hands in the fetched {@link AssetDetail} and
 * learns about edits through the outputs. Anyone with a write grant can edit
 * the title and date or re-run processing; everyone else sees read-only facts.
 */
@Component({
  selector: 'app-asset-info-panel',
  imports: [FormsModule, Icon, RouterLink],
  templateUrl: './asset-info-panel.html',
  styleUrl: './asset-info-panel.scss',
})
export class AssetInfoPanel {
  /** The item on screen; edits and reprocess target this id. */
  readonly asset = input.required<TimelineAsset>();
  /** The loaded metadata, or null while it loads or if it could not load. */
  readonly detail = input<AssetDetail | null>(null);
  readonly detailLoading = input<boolean>(false);
  /** The name to show, or null for none. A just-saved edit wins over this. */
  readonly title = input<string | null>(null);
  /** A corrected capture date the host already knows about, if any. */
  readonly capturedAt = input<string | null>(null);
  /** Hosts without their own dismiss gesture ask for a Close button. */
  readonly isClosable = input<boolean>(false);

  /** A new title was saved (null when it was removed). */
  readonly titleChanged = output<string | null>();
  /** A corrected capture date was saved, as an ISO instant. */
  readonly capturedAtChanged = output<string>();
  /** Fresh metadata arrived while a reprocess was being watched. */
  readonly reprocessed = output<AssetDetail>();
  readonly closed = output<void>();

  readonly editingTitle = signal(false);
  readonly savingTitle = signal(false);
  readonly editingDate = signal(false);
  readonly savingDate = signal(false);
  readonly reprocessState = signal<ReprocessState>('idle');
  /** Bound to the title input. */
  titleDraft = '';
  /** Bound to the datetime-local input, "YYYY-MM-DDTHH:MM". */
  dateDraft = '';

  /** A title saved from this panel; undefined until then. */
  private readonly savedTitle = signal<string | null | undefined>(undefined);
  private readonly savedCapturedAt = signal<string | null>(null);
  private reprocessPoll: ReturnType<typeof setInterval> | null = null;

  private readonly auth = inject(AuthStateService);
  private readonly photosApi = inject(PhotosApiService);
  private readonly assetDetailApi = inject(AssetDetailApiService);
  private readonly toasts = inject(ToastService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** The title to show - a just-saved edit wins over the one handed in. */
  readonly displayTitle = computed<string | null>(() => {
    const saved = this.savedTitle();
    return saved !== undefined ? saved : this.title();
  });

  readonly canWrite = computed<boolean>(() => {
    const permission = this.auth.user()?.permission;
    return permission === 'write' || permission === 'delete';
  });

  constructor() {
    // Everything edit-related belongs to one photo; a different one starts clean.
    effect(() => {
      this.asset().id;
      untracked(() => this.resetForNewAsset());
    });
    inject(DestroyRef).onDestroy(() => this.stopReprocessPoll());
  }

  /** Moves keyboard focus into the panel, e.g. when a host opens it. */
  focus(): void {
    this.host.nativeElement.querySelector<HTMLElement>('aside')?.focus();
  }

  /** The date to show - a just-saved correction wins over the loaded value. */
  displayCapturedAt(iso: string): string {
    // The detail payload is authoritative; the timeline copy is a stub when the
    // viewer was opened from a synthetic list (dashboard, album, person page).
    return this.savedCapturedAt() ?? this.capturedAt() ?? this.detail()?.capturedAt ?? iso;
  }

  formatDate(iso: string): string {
    return formatCapturedDate(iso);
  }

  /** Plain-language provenance for the capture date. */
  capturedSourceLabel(source: string | undefined): string {
    switch (source) {
      case 'exif':
        return 'from the camera';
      case 'filename':
        return 'read from the file name';
      case 'file_mtime':
        return 'from the file date — may not be when it was taken';
      case 'user':
        return 'set by you';
      default:
        return '';
    }
  }

  /** Human summary of what failed for this item, or empty when healthy. */
  processingProblem(info: AssetDetail): string {
    if (info.stageErrors) {
      return Object.entries(info.stageErrors)
        .map(([stage, message]) => `${stage}: ${message}`)
        .join('; ');
    }
    if (!info.hasThumbnail) {
      return 'Thumbnail was never generated.';
    }
    return '';
  }

  formatSize(bytes: number | null): string {
    if (bytes === null) {
      return '';
    }
    if (bytes < 1024 * 1024) {
      return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  /** A file this small is almost never a real photo - likely a cloud-only stub. */
  isSuspiciouslySmall(info: AssetDetail): boolean {
    return (
      info.mediaType === 'image' && info.sizeBytes !== null && info.sizeBytes < SUSPICIOUS_SIZE_BYTES
    );
  }

  googleMapsUrl(info: AssetDetail): string {
    return `https://www.google.com/maps?q=${info.gpsLat},${info.gpsLon}`;
  }

  /** The folder holding this file, for linking into the folders view. */
  folderOf(info: AssetDetail): string {
    return (info.relPath ?? '').split('/').slice(0, -1).join('/');
  }

  // --- Title ---------------------------------------------------------------

  startEditTitle(): void {
    this.titleDraft = this.displayTitle() ?? '';
    this.editingTitle.set(true);
  }

  cancelEditTitle(): void {
    this.editingTitle.set(false);
  }

  async saveTitle(): Promise<void> {
    if (this.savingTitle()) {
      return;
    }
    const assetId = this.asset().id;
    const title = this.titleDraft.trim();
    this.savingTitle.set(true);
    try {
      await this.photosApi.setTitle(assetId, title);
      this.applySavedTitle(assetId, title || null);
      this.toasts.success(title ? 'Title saved.' : 'Title removed.');
    } catch (error) {
      this.toasts.error(describeError(error, "Couldn't save the title."));
    } finally {
      this.savingTitle.set(false);
    }
  }

  // --- Capture date --------------------------------------------------------

  startEditDate(): void {
    const asset = this.asset();
    this.dateDraft = toLocalInputValue(this.savedCapturedAt() ?? this.capturedAt() ?? asset.capturedAt);
    this.editingDate.set(true);
  }

  cancelEditDate(): void {
    this.editingDate.set(false);
  }

  async saveDate(): Promise<void> {
    if (this.savingDate() || !this.dateDraft) {
      return;
    }
    const local = new Date(this.dateDraft);
    if (Number.isNaN(local.getTime())) {
      this.toasts.error('That date is not valid.');
      return;
    }
    const assetId = this.asset().id;
    this.savingDate.set(true);
    try {
      await this.photosApi.setCapturedAt(assetId, local.toISOString(), -local.getTimezoneOffset());
      this.applySavedDate(assetId, local.toISOString());
      this.toasts.success('Date updated — saved to the file too.');
    } catch (error) {
      this.toasts.error(describeError(error, "Couldn't update the date."));
    } finally {
      this.savingDate.set(false);
    }
  }

  // --- Reprocess -----------------------------------------------------------

  /** Queues a re-run of processing for this item and watches until it lands. */
  async reprocess(): Promise<void> {
    if (this.reprocessState() === 'running') {
      return;
    }
    const assetId = this.asset().id;
    this.reprocessState.set('running');
    try {
      await this.photosApi.reprocess(assetId);
    } catch (error) {
      this.reprocessState.set('idle');
      this.toasts.error(describeError(error, "Couldn't start reprocessing."));
      return;
    }
    this.watchReprocess(assetId);
  }

  private watchReprocess(assetId: string): void {
    const startedAt = Date.now();
    this.stopReprocessPoll();
    this.reprocessPoll = setInterval(() => {
      if (this.asset().id !== assetId || Date.now() - startedAt > REPROCESS_GIVE_UP_MS) {
        this.stopReprocessPoll();
        this.reprocessState.set('idle');
        return;
      }
      void this.refreshWhileReprocessing(assetId);
    }, REPROCESS_POLL_MS);
  }

  private async refreshWhileReprocessing(assetId: string): Promise<void> {
    try {
      const info = await this.assetDetailApi.get(assetId);
      if (this.asset().id !== assetId || this.reprocessPoll === null) {
        return;
      }
      this.reprocessed.emit(info);
      if (info.hasThumbnail && !info.stageErrors) {
        this.stopReprocessPoll();
        this.reprocessState.set('done');
      }
    } catch {
      // Keep watching; a failed poll just means "not yet".
    }
  }

  private stopReprocessPoll(): void {
    if (this.reprocessPoll !== null) {
      clearInterval(this.reprocessPoll);
      this.reprocessPoll = null;
    }
  }

  // --- Internals -----------------------------------------------------------

  private applySavedTitle(assetId: string, title: string | null): void {
    if (this.asset().id !== assetId) {
      return;
    }
    this.savedTitle.set(title);
    this.editingTitle.set(false);
    this.titleChanged.emit(title);
  }

  private applySavedDate(assetId: string, iso: string): void {
    if (this.asset().id !== assetId) {
      return;
    }
    this.savedCapturedAt.set(iso);
    this.editingDate.set(false);
    this.capturedAtChanged.emit(iso);
  }

  private resetForNewAsset(): void {
    this.stopReprocessPoll();
    this.reprocessState.set('idle');
    this.editingTitle.set(false);
    this.editingDate.set(false);
    this.savedTitle.set(undefined);
    this.savedCapturedAt.set(null);
  }
}
