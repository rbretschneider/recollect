import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { SharingApiService } from '../../core/api/sharing-api.service';
import { SharedView, TimelineAsset } from '../../core/api/api-models';
import { AssetViewer } from '../viewer/asset-viewer';

/** The public page behind a share link. No account, no navigation chrome. */
@Component({
  selector: 'app-shared-view-page',
  imports: [AssetViewer],
  templateUrl: './shared-view-page.html',
  styleUrl: './shared-view-page.scss',
})
export class SharedViewPage implements OnInit {
  private readonly api = inject(SharingApiService);
  private readonly route = inject(ActivatedRoute);

  readonly view = signal<SharedView | null>(null);
  readonly isUnavailable = signal(false);
  readonly viewerIndex = signal<number | null>(null);

  token = '';

  ngOnInit(): void {
    this.token = this.route.snapshot.paramMap.get('token') ?? '';
    void this.load();
  }

  get mediaBase(): string {
    return `/api/v1/share/${this.token}/assets`;
  }

  thumbUrl(assetId: string): string {
    return this.api.sharedThumbUrl(this.token, assetId, 240);
  }

  /** computed: the viewer needs a stable array reference (see person page). */
  readonly viewerAssets = computed<TimelineAsset[]>(() => {
    const view = this.view();
    if (!view) {
      return [];
    }
    return view.assetIds.map((id) => ({
      id,
      mediaType: 'image' as const,
      capturedAt: view.startAt ?? new Date(0).toISOString(),
      capturedDay: (view.startAt ?? '').slice(0, 10),
      width: null,
      height: null,
      durationMs: null,
      hasThumbnail: true,
      isFavorite: false,
    }));
  });

  formatSpan(view: SharedView): string {
    if (!view.startAt || !view.endAt) {
      return '';
    }
    const start = new Date(view.startAt);
    const end = new Date(view.endAt);
    const format = new Intl.DateTimeFormat(undefined, {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
    return start.toDateString() === end.toDateString()
      ? format.format(start)
      : `${format.format(start)} – ${format.format(end)}`;
  }

  openViewer(index: number): void {
    this.viewerIndex.set(index);
  }

  closeViewer(): void {
    this.viewerIndex.set(null);
  }

  private async load(): Promise<void> {
    try {
      this.view.set(await this.api.getShared(this.token));
    } catch {
      this.isUnavailable.set(true);
    }
  }
}
