import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { formatDateSpan } from '../../core/format-date';
import { ActivatedRoute } from '@angular/router';
import { SharingApiService } from '../../core/api/sharing-api.service';
import { SharedView, TimelineAsset, toViewerAsset } from '../../core/api/api-models';
import { SlideItem, SlideshowOverlay } from '../dashboard/slideshow-overlay';
import { AssetViewer } from '../viewer/asset-viewer';

/** The public page behind a share link. No account, no navigation chrome. */
@Component({
  selector: 'app-shared-view-page',
  imports: [AssetViewer, SlideshowOverlay],
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
    const typeById = new Map((view.mediaItems ?? []).map((item) => [item.id, item.mediaType]));
    return view.assetIds.map((id) =>
      toViewerAsset(id, typeById.get(id) ?? 'image', view.startAt ?? new Date(0).toISOString()),
    );
  });

  formatSpan(view: SharedView): string {
    return formatDateSpan(view.startAt, view.endAt);
  }

  openViewer(index: number): void {
    this.viewerIndex.set(index);
  }

  /** Play everything as a music-backed slideshow, token-scoped media. */
  readonly showSlideshow = signal(false);

  readonly slideshowItems = computed<SlideItem[]>(
    () => this.view()?.mediaItems ?? [],
  );

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
