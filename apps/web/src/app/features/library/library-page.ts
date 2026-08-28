import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { LibraryApiService, ScanScheduleView } from '../../core/api/library-api.service';
import { LibraryFailure, LibraryRootView, LibraryStatus } from '../../core/api/api-models';
import { AuthStateService } from '../../core/auth/auth-state.service';
import { AccountBadge } from '../../shared/account-badge';
import { MenuButton } from '../../shared/menu-button';
import { BackButton } from '../../shared/back-button';
import { ConfirmService } from '../../shared/confirm.service';
import { FolderPicker } from '../../shared/folder-picker';
import { PageLoading } from '../../shared/page-loading';
import { LoadError } from '../../shared/load-error';
import { ToastService } from '../../shared/toast.service';
import { Sheet } from '../../shared/sheet';

const STATUS_POLL_MS = 2500;

/** Plain-language names for the background work the queue is doing. */
const JOB_LABELS: Record<string, string> = {
  scan_root: 'Scanning folders',
  ingest_file: 'Indexing new files',
  reprocess_asset: 'Reprocessing files',
  detect_events: 'Finding memories',
  detect_faces: 'Finding faces',
  embed_clip: 'Understanding photos for search',
  transcode_playback: 'Preparing videos for playback',
  transcode_backfill: 'Checking videos',
  exif_backfill: 'Reading camera settings',
  geocode_backfill: 'Naming places',
  purge_trash: 'Emptying trash',
};

/**
 * The Library page (PhotoPrism-style): folder locations, live indexing
 * state with a start/cancel, and what failed. Settings keeps accounts and
 * cameras; everything about the files themselves lives here.
 */
@Component({
  selector: 'app-library-page',
  imports: [AccountBadge, MenuButton, BackButton, FolderPicker, FormsModule, PageLoading, LoadError, RouterLink, Sheet],
  templateUrl: './library-page.html',
  styleUrl: './library-page.scss',
})
export class LibraryPage implements OnInit {
  private readonly api = inject(LibraryApiService);
  private readonly auth = inject(AuthStateService);
  private readonly confirms = inject(ConfirmService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly toasts = inject(ToastService);

  readonly roots = signal<LibraryRootView[]>([]);
  readonly status = signal<LibraryStatus | null>(null);
  readonly failures = signal<LibraryFailure[] | null>(null);
  readonly isLoaded = signal(false);
  readonly loadFailed = signal(false);
  readonly isAddingFolder = signal(false);
  readonly justQueuedRootId = signal<string | null>(null);
  readonly isCancelling = signal(false);
  readonly error = signal<string | null>(null);
  readonly scheduleView = signal<ScanScheduleView | null>(null);
  readonly scheduleJustSaved = signal(false);
  /** Bound to the schedule controls; every change saves immediately. */
  scheduleDraft: ScanScheduleView['schedule'] = { mode: 'interval', time: '03:00', weekday: 0 };

  readonly weekdays = [
    { value: 0, label: 'Sunday' },
    { value: 1, label: 'Monday' },
    { value: 2, label: 'Tuesday' },
    { value: 3, label: 'Wednesday' },
    { value: 4, label: 'Thursday' },
    { value: 5, label: 'Friday' },
    { value: 6, label: 'Saturday' },
  ];

  readonly pendingCount = computed(() => {
    const status = this.status();
    return status ? status.queuedJobs + status.runningJobs : 0;
  });

  /** 0..1 of the current ingest batch, for the progress bar. */
  readonly batchProgress = computed(() => {
    const status = this.status();
    if (!status || status.batchTotal === 0 || status.ingestPending === 0) {
      return null;
    }
    return Math.min(1, (status.batchTotal - status.ingestPending) / status.batchTotal);
  });

  readonly activeWork = computed(() => {
    const status = this.status();
    return (status?.byType ?? []).map((entry) => ({
      label: JOB_LABELS[entry.type] ?? entry.type,
      count: entry.queued + entry.running,
      isRunning: entry.running > 0,
    }));
  });

  get isAdmin(): boolean {
    return this.auth.user()?.isAdmin ?? false;
  }

  get canDelete(): boolean {
    return this.auth.user()?.permission === 'delete';
  }

  ngOnInit(): void {
    void this.reload();
    const timer = setInterval(() => void this.pollStatus(), STATUS_POLL_MS);
    this.destroyRef.onDestroy(() => clearInterval(timer));
  }

  async addFolder(path: string): Promise<void> {
    this.error.set(null);
    this.isAddingFolder.set(false);
    try {
      const name = path.split(/[\\/]/).filter((part) => part.length > 0).pop() ?? 'Photos';
      const { root } = await this.api.createRoot(path, name);
      this.justQueuedRootId.set(root.id);
      await this.reload();
    } catch (error) {
      this.error.set(this.messageFrom(error, 'Could not add that folder.'));
    }
  }

  async scanNow(root: LibraryRootView): Promise<void> {
    this.justQueuedRootId.set(root.id);
    try {
      await this.api.rescan(root.id);
      await this.pollStatus();
    } catch {
      // Don't strand the row on "Scanning…" when the queue call never landed.
      this.justQueuedRootId.set(null);
      this.toasts.error(`Couldn't start a scan of “${root.name}”.`, {
        label: 'Retry',
        run: () => void this.scanNow(root),
      });
    }
  }

  /** Cancels queued indexing work; running files finish, rescan redoes the rest. */
  async cancelScan(): Promise<void> {
    const confirmed = await this.confirms.ask({
      title: 'Cancel indexing?',
      message:
        'Queued scan work is dropped (files already being processed will finish). Nothing is lost — Scan now picks up where it left off.',
      confirmLabel: 'Cancel indexing',
    });
    if (!confirmed) {
      return;
    }
    this.isCancelling.set(true);
    try {
      await this.api.cancelScan();
      this.justQueuedRootId.set(null);
      await this.pollStatus();
    } finally {
      this.isCancelling.set(false);
    }
  }

  /** Saves on every control change (three-signal: the Saved ✓ chip flashes). */
  async saveSchedule(): Promise<void> {
    try {
      // Confirm the save landed before flashing "Saved ✓".
      const view = await this.api.setSchedule({ ...this.scheduleDraft });
      this.scheduleView.set(view);
      this.scheduleJustSaved.set(true);
      setTimeout(() => this.scheduleJustSaved.set(false), 2000);
    } catch {
      // Roll the controls back to the last saved schedule so the UI doesn't
      // claim a change that didn't take.
      const saved = this.scheduleView()?.schedule;
      if (saved) {
        this.scheduleDraft = { ...saved };
      }
      this.toasts.error("Couldn't save the scan schedule.");
    }
  }

  formatNextRun(iso: string): string {
    return new Intl.DateTimeFormat(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(iso));
  }

  async toggleEnabled(root: LibraryRootView): Promise<void> {
    try {
      const { root: updated } = await this.api.setRootEnabled(root.id, !root.enabled);
      this.roots.update((list) => list.map((entry) => (entry.id === updated.id ? updated : entry)));
    } catch {
      this.toasts.error(
        `Couldn't ${root.enabled ? 'pause' : 'resume'} “${root.name}”.`,
        { label: 'Retry', run: () => void this.toggleEnabled(root) },
      );
    }
  }

  /** Unregisters a folder. Files on disk are never touched. */
  async removeRoot(root: LibraryRootView): Promise<void> {
    const confirmed = await this.confirms.ask({
      title: `Remove “${root.name}”?`,
      message:
        'The folder stops being indexed and its photos show as missing here. NOTHING on disk is deleted — add the folder back any time and everything returns.',
      confirmLabel: 'Remove folder',
    });
    if (!confirmed) {
      return;
    }
    try {
      // Await removal before dropping the card, so a failed call keeps the
      // folder visible instead of pretending it's gone.
      await this.api.removeRoot(root.id);
      this.roots.update((list) => list.filter((entry) => entry.id !== root.id));
      this.toasts.success(`Removed “${root.name}”`);
    } catch {
      this.toasts.error(`Couldn't remove “${root.name}”.`, {
        label: 'Retry',
        run: () => void this.removeRoot(root),
      });
    }
  }

  async toggleFailures(): Promise<void> {
    if (this.failures() !== null) {
      this.failures.set(null);
      return;
    }
    const { failures } = await this.api.listFailures();
    this.failures.set(failures);
  }

  scanButtonLabel(root: LibraryRootView): string {
    if (this.justQueuedRootId() === root.id && this.pendingCount() === 0) {
      return 'Scan queued ✓';
    }
    if (this.justQueuedRootId() === root.id) {
      return 'Scanning…';
    }
    return 'Scan now';
  }

  lastScanLabel(root: LibraryRootView): string {
    if (!root.lastScanCompletedAt) {
      return 'Not scanned yet';
    }
    return `Last scan ${new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(root.lastScanCompletedAt))}`;
  }

  protected async reload(): Promise<void> {
    this.loadFailed.set(false);
    try {
      const [{ roots }] = await Promise.all([this.api.listRoots(), this.pollStatus()]);
      this.roots.set(roots);
      if (this.isAdmin) {
        const view = await this.api.getSchedule();
        this.scheduleView.set(view);
        this.scheduleDraft = { ...view.schedule };
      }
      this.isLoaded.set(true);
    } catch {
      this.loadFailed.set(true);
    }
  }

  private async pollStatus(): Promise<void> {
    try {
      const previousPending = this.pendingCount();
      this.status.set(await this.api.getStatus());
      // Completion: refresh last-scan stamps when the queue drains.
      if (previousPending > 0 && this.pendingCount() === 0) {
        this.justQueuedRootId.set(null);
        const { roots } = await this.api.listRoots();
        this.roots.set(roots);
      }
    } catch {
      // Polling is a nicety; the page stays usable.
    }
  }

  private messageFrom(error: unknown, fallback: string): string {
    const message = (error as { error?: { message?: string | string[] } })?.error?.message;
    return (Array.isArray(message) ? message[0] : message) ?? fallback;
  }
}
