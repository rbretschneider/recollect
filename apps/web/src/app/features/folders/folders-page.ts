import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  FolderAsset,
  FolderListing,
  FoldersApiService,
  RootEntry,
} from '../../core/api/folders-api.service';
import { TimelineAsset } from '../../core/api/api-models';
import { AvatarMenu } from '../../shared/avatar-menu';
import { BackButton } from '../../shared/back-button';
import { BottomNav } from '../../shared/bottom-nav';
import { Icon } from '../../shared/icon';
import { PageLoading } from '../../shared/page-loading';
import { AssetViewer } from '../viewer/asset-viewer';

/** A breadcrumb segment in the folder path. */
interface Crumb {
  label: string;
  path: string;
}

const FOLDER_VIEW_KEY = 'rc-folder-view';

function loadFolderView(): 'cards' | 'list' {
  try {
    return localStorage.getItem(FOLDER_VIEW_KEY) === 'list' ? 'list' : 'cards';
  } catch {
    return 'cards';
  }
}

/**
 * Filesystem-shaped browsing (PhotoPrism-style Folders): the user's own
 * on-disk organization is the navigation. Driven by ?root= and ?path=.
 */
@Component({
  selector: 'app-folders-page',
  imports: [AvatarMenu, PageLoading, BackButton, AssetViewer, BottomNav, Icon, RouterLink],
  templateUrl: './folders-page.html',
  styleUrl: './folders-page.scss',
})
export class FoldersPage implements OnInit {
  private readonly api = inject(FoldersApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly roots = signal<RootEntry[]>([]);
  readonly listing = signal<FolderListing | null>(null);
  readonly viewerIndex = signal<number | null>(null);
  readonly isLoaded = signal(false);
  /** Card grid or full-name list; per-device preference. */
  readonly folderView = signal<'cards' | 'list'>(loadFolderView());

  setFolderView(view: 'cards' | 'list'): void {
    this.folderView.set(view);
    try {
      localStorage.setItem(FOLDER_VIEW_KEY, view);
    } catch {
      // Per-device convenience only.
    }
  }

  readonly crumbs = computed<Crumb[]>(() => {
    const listing = this.listing();
    if (!listing) {
      return [];
    }
    const crumbs: Crumb[] = [{ label: listing.rootName, path: '' }];
    let assembled = '';
    for (const segment of listing.path.split('/').filter((part) => part.length > 0)) {
      assembled = assembled.length > 0 ? `${assembled}/${segment}` : segment;
      crumbs.push({ label: segment, path: assembled });
    }
    return crumbs;
  });

  ngOnInit(): void {
    this.route.queryParamMap.subscribe((params) => {
      void this.load(params.get('root'), params.get('path') ?? '');
    });
  }

  thumbUrl(assetId: string): string {
    return `/api/v1/assets/${assetId}/thumb/240`;
  }

  coverUrl(coverAssetId: string | null): string | null {
    return coverAssetId ? `/api/v1/assets/${coverAssetId}/thumb/240` : null;
  }

  openRoot(root: RootEntry): void {
    void this.router.navigate([], { queryParams: { root: root.rootId, path: '' } });
  }

  openFolder(path: string): void {
    const listing = this.listing();
    if (listing) {
      void this.router.navigate([], { queryParams: { root: listing.rootId, path } });
    }
  }

  openViewer(index: number): void {
    this.viewerIndex.set(index);
  }

  closeViewer(): void {
    this.viewerIndex.set(null);
  }

  /** The viewer consumes TimelineAsset shapes; adapt the folder assets. */
  viewerAssets(): TimelineAsset[] {
    return (this.listing()?.assets ?? []).map((asset) => this.toTimelineAsset(asset));
  }

  private async load(rootId: string | null, path: string): Promise<void> {
    if (rootId) {
      this.listing.set(await this.api.browse(rootId, path));
    } else {
      const { roots } = await this.api.listRoots();
      // One root: skip the pointless top level and jump straight in.
      if (roots.length === 1) {
        void this.router.navigate([], {
          queryParams: { root: roots[0].rootId, path: '' },
          replaceUrl: true,
        });
        return;
      }
      this.roots.set(roots);
      this.listing.set(null);
    }
    this.isLoaded.set(true);
  }

  private toTimelineAsset(asset: FolderAsset): TimelineAsset {
    return {
      id: asset.id,
      mediaType: asset.mediaType,
      capturedAt: asset.capturedAt,
      capturedDay: asset.capturedAt.slice(0, 10),
      width: null,
      height: null,
      durationMs: null,
      hasThumbnail: asset.hasThumbnail,
      isFavorite: false,
    };
  }
}
