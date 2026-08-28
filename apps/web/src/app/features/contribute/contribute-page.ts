import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { HttpEventType } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { ContributeView, ContributionsApiService } from '../../core/api/contributions-api.service';
import { TimelineAsset } from '../../core/api/api-models';
import { Icon } from '../../shared/icon';
import { PageLoading } from '../../shared/page-loading';
import { AssetViewer } from '../viewer/asset-viewer';
import { SlideshowOverlay } from '../dashboard/slideshow-overlay';

const GUEST_NAME_KEY = 'recollect.guestName';

/** One file moving through the guest upload queue. */
interface UploadItem {
  file: File;
  state: 'queued' | 'uploading' | 'done' | 'failed';
  /** 0..100 while uploading. */
  progress: number;
  error: string | null;
}

/**
 * The public guest page behind a contribution link: type your name once, add
 * photos, watch them upload. Everything lands in the household's review queue
 * — guests are told their photos are "waiting for review", and (when the host
 * allows it) they see the approved pool grow.
 */
@Component({
  selector: 'app-contribute-page',
  imports: [AssetViewer, FormsModule, Icon, PageLoading, SlideshowOverlay],
  templateUrl: './contribute-page.html',
  styleUrl: './contribute-page.scss',
})
export class ContributePage implements OnInit {
  private readonly api = inject(ContributionsApiService);
  private readonly route = inject(ActivatedRoute);

  readonly view = signal<ContributeView | null>(null);
  readonly linkGone = signal(false);
  readonly isLoading = signal(true);
  readonly queue = signal<UploadItem[]>([]);
  readonly isUploading = signal(false);
  guestName = '';

  private token = '';

  ngOnInit(): void {
    this.token = this.route.snapshot.paramMap.get('token') ?? '';
    try {
      this.guestName = localStorage.getItem(GUEST_NAME_KEY) ?? '';
    } catch {
      this.guestName = '';
    }
    void this.load();
  }

  get doneCount(): number {
    return this.queue().filter((item) => item.state === 'done').length;
  }

  get hasName(): boolean {
    return this.guestName.trim().length > 0;
  }

  poolThumbUrl(assetId: string): string {
    return this.api.poolThumbUrl(this.token, assetId);
  }

  readonly showSlideshow = signal(false);

  /** Fullscreen viewing for guests, through the token-scoped media routes. */
  readonly viewerIndex = signal<number | null>(null);

  get viewerMediaBase(): string {
    return `/api/v1/contribute/${this.token}/assets`;
  }

  readonly viewerAssets = computed<TimelineAsset[]>(() =>
    (this.view()?.poolItems ?? []).map((item) => ({
      id: item.id,
      mediaType: item.mediaType,
      capturedAt: new Date(0).toISOString(),
      capturedDay: '',
      width: null,
      height: null,
      durationMs: null,
      hasThumbnail: true,
      isFavorite: false,
    })),
  );

  openViewer(index: number): void {
    this.viewerIndex.set(index);
  }

  closeViewer(): void {
    this.viewerIndex.set(null);
  }

  expiryLabel(view: ContributeView): string {
    const remaining = new Date(view.expiresAt).getTime() - Date.now();
    if (remaining <= 0) {
      return 'This link has expired.';
    }
    const hours = Math.round(remaining / (60 * 60 * 1000));
    return hours < 48
      ? `Open for another ${hours} hours`
      : `Open for another ${Math.round(hours / 24)} days`;
  }

  onNameChange(): void {
    try {
      localStorage.setItem(GUEST_NAME_KEY, this.guestName.trim());
    } catch {
      // Private-mode browsers refuse storage; the name still works for this visit.
    }
  }

  onFilesChosen(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = ''; // Re-choosing the same files must fire change again.
    if (files.length === 0 || !this.hasName) {
      return;
    }
    this.queue.update((existing) => [
      ...existing,
      ...files.map<UploadItem>((file) => ({ file, state: 'queued', progress: 0, error: null })),
    ]);
    void this.drainQueue();
  }

  /** Uploads one at a time: progress stays honest and the server stays calm. */
  private async drainQueue(): Promise<void> {
    if (this.isUploading()) {
      return;
    }
    this.isUploading.set(true);
    try {
      for (;;) {
        const next = this.queue().find((item) => item.state === 'queued');
        if (!next) {
          break;
        }
        await this.uploadOne(next);
      }
    } finally {
      this.isUploading.set(false);
    }
    // Uploads land in the album right away — show the guest their photos
    // in the pool as soon as the batch settles.
    await this.load();
  }

  private uploadOne(item: UploadItem): Promise<void> {
    this.patchItem(item, { state: 'uploading', progress: 0 });
    return new Promise((resolve) => {
      this.api.uploadFile(this.token, this.guestName.trim(), item.file).subscribe({
        next: (event) => {
          if (event.type === HttpEventType.UploadProgress && event.total) {
            this.patchItem(item, {
              progress: Math.round((event.loaded / event.total) * 100),
            });
          }
          if (event.type === HttpEventType.Response) {
            this.patchItem(item, { state: 'done', progress: 100 });
          }
        },
        error: (error: { error?: { message?: string } }) => {
          this.patchItem(item, {
            state: 'failed',
            error: error?.error?.message ?? "This one didn't make it — try again.",
          });
          resolve();
        },
        complete: () => resolve(),
      });
    });
  }

  retry(item: UploadItem): void {
    this.patchItem(item, { state: 'queued', progress: 0, error: null });
    void this.drainQueue();
  }

  private patchItem(item: UploadItem, patch: Partial<UploadItem>): void {
    this.queue.update((items) =>
      items.map((existing) => (existing === item ? Object.assign(existing, patch) : existing)),
    );
  }

  private async load(): Promise<void> {
    try {
      this.view.set(await this.api.getContributeView(this.token));
    } catch {
      this.linkGone.set(true);
    } finally {
      this.isLoading.set(false);
    }
  }
}
