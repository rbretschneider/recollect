import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { formatDateSpan } from '../../core/format-date';
import { ActivatedRoute } from '@angular/router';
import { SharingApiService } from '../../core/api/sharing-api.service';
import { SharedView, TimelineAsset, toViewerAsset } from '../../core/api/api-models';
import { SlideItem, SlideshowOverlay } from '../dashboard/slideshow-overlay';
import { AssetViewer } from '../viewer/asset-viewer';
import { Icon } from '../../shared/icon';

/** The public page behind a share link. No account, no navigation chrome. */
@Component({
  selector: 'app-shared-view-page',
  imports: [AssetViewer, SlideshowOverlay, Icon],
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

  thumbUrl(assetId: string, size: 240 | 720 | 1440 = 240): string {
    return this.api.sharedThumbUrl(this.token, assetId, size);
  }

  faceCropUrl(faceId: string): string {
    return this.api.sharedFaceCropUrl(this.token, faceId);
  }

  /** Captions passed to the viewer so shared photos carry their words too. */
  readonly captions = computed<Record<string, string>>(() => this.view()?.captions ?? {});

  /** Captioned photos grouped by shared caption (same as the private read). */
  readonly storyGroups = computed<Array<{ caption: string; assetIds: string[] }>>(() => {
    const view = this.view();
    if (!view) {
      return [];
    }
    const byCaption = new Map<string, string[]>();
    for (const id of view.assetIds) {
      const caption = view.captions[id];
      if (!caption) {
        continue;
      }
      const existing = byCaption.get(caption);
      if (existing) {
        existing.push(id);
      } else {
        byCaption.set(caption, [id]);
      }
    }
    return [...byCaption.entries()].map(([caption, assetIds]) => ({ caption, assetIds }));
  });

  /** The primary journal entry, split into paragraphs for interleaving. */
  readonly journalParagraphs = computed<string[]>(() => {
    const text = this.view()?.journal[0]?.bodyMd.trim() ?? '';
    return text ? text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean) : [];
  });

  /** Extra journal entries beyond the first, shown after the woven story. */
  readonly extraJournal = computed(() => this.view()?.journal.slice(1) ?? []);

  /** The woven read: journal paragraphs with captioned figures in the gaps. */
  readonly storyFlow = computed<
    Array<{ kind: 'text'; text: string } | { kind: 'figure'; caption: string; assetIds: string[] }>
  >(() => {
    const paras = this.journalParagraphs();
    const groups = this.storyGroups();
    const flow: Array<
      { kind: 'text'; text: string } | { kind: 'figure'; caption: string; assetIds: string[] }
    > = [];
    if (paras.length === 0) {
      for (const group of groups) {
        flow.push({ kind: 'figure', ...group });
      }
      return flow;
    }
    const inlineCount = Math.min(groups.length, paras.length);
    const afterPara = new Map<number, number>();
    for (let i = 0; i < inlineCount; i++) {
      afterPara.set(Math.floor(((i + 1) * paras.length) / (inlineCount + 1)), i);
    }
    paras.forEach((text, index) => {
      flow.push({ kind: 'text', text });
      const groupIndex = afterPara.get(index);
      if (groupIndex !== undefined) {
        flow.push({ kind: 'figure', ...groups[groupIndex] });
      }
    });
    for (let i = inlineCount; i < groups.length; i++) {
      flow.push({ kind: 'figure', ...groups[i] });
    }
    return flow;
  });

  /** Uncaptioned photos — the tappable polaroid stack at the end. */
  readonly looseAssetIds = computed<string[]>(() => {
    const view = this.view();
    return view ? view.assetIds.filter((id) => !view.captions[id]) : [];
  });

  /** Up to four fanned previews for the end-of-story stack. */
  readonly loosePreview = computed<string[]>(() => this.looseAssetIds().slice(0, 4));

  /** Opens the viewer at a given asset id (captioned figures are clickable). */
  openViewerForAsset(assetId: string): void {
    const index = this.viewerAssets().findIndex((asset) => asset.id === assetId);
    if (index >= 0) {
      this.viewerIndex.set(index);
    }
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
