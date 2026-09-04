import { Component, inject, OnInit, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { assetThumbUrl } from '../../core/api/photos-api.service';
import { AlbumsApiService } from '../../core/api/albums-api.service';
import { SharingApiService } from '../../core/api/sharing-api.service';
import { AppTopbar } from '../../shared/app-topbar';
import { PageLoading } from '../../shared/page-loading';
import { LoadError } from '../../shared/load-error';
import { Icon } from '../../shared/icon';
import { Sheet } from '../../shared/sheet';
import { ToastService } from '../../shared/toast.service';
import { SlideshowOverlay, SlideItem, SlideshowCollection } from '../dashboard/slideshow-overlay';

interface OnThisDayMoment {
  key: string;
  kind: 'memory' | 'place' | 'person';
  year: number;
  title: string;
  subtitle: string | null;
  memoryId: string | null;
  personId: string | null;
  coverAssetId: string;
  items: Array<{ id: string; mediaType: 'image' | 'video' }>;
}

/**
 * The daily push notification opens here: this week's look-backs through the
 * years. Shareable — internally (a signed-in family member, via a return-URL
 * login) or as a quick public snapshot link.
 */
@Component({
  selector: 'app-lookback-page',
  imports: [AppTopbar, PageLoading, LoadError, RouterLink, Icon, Sheet, SlideshowOverlay],
  templateUrl: './lookback-page.html',
  styleUrl: './lookback-page.scss',
})
export class LookbackPage implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly albums = inject(AlbumsApiService);
  private readonly sharing = inject(SharingApiService);
  private readonly toasts = inject(ToastService);

  readonly moments = signal<OnThisDayMoment[]>([]);
  readonly loading = signal(true);
  readonly loadFailed = signal(false);
  readonly slideshowItems = signal<SlideItem[] | null>(null);
  readonly slideshowTitle = signal('');

  /** The exact look-back being viewed, so a shared link pins the same set. */
  private day = todayMmDd();
  private year = new Date().getFullYear();

  readonly shareOpen = signal(false);
  readonly publicBusy = signal(false);
  readonly publicUrl = signal<string | null>(null);

  readonly todayLabel = new Date().toLocaleDateString(undefined, {
    month: 'long',
    day: 'numeric',
  });

  ngOnInit(): void {
    void this.load();
  }

  thumbUrl(assetId: string, size: 240 | 720 = 720): string {
    return assetThumbUrl(assetId, size);
  }

  yearsAgo(year: number): string {
    const diff = new Date().getFullYear() - year;
    return diff === 1 ? 'A year ago' : `${diff} years ago`;
  }

  momentMeta(moment: OnThisDayMoment): string {
    const count = `${moment.items.length} ${moment.items.length === 1 ? 'photo' : 'photos'}`;
    const parts = [String(moment.year), count];
    if (moment.subtitle) {
      parts.push(moment.subtitle);
    }
    return parts.join(' · ');
  }

  stackPreview(moment: OnThisDayMoment): Array<{ id: string; mediaType: string }> {
    return moment.items.slice(0, 4);
  }

  /** The moment on screen, so the slideshow can offer to share it. */
  readonly slideshowCollection = signal<SlideshowCollection | null>(null);

  openSlideshow(moment: OnThisDayMoment): void {
    this.slideshowTitle.set(`${moment.title} · ${this.yearsAgo(moment.year)}`);
    this.slideshowItems.set(moment.items);
    this.slideshowCollection.set({
      title: `${moment.title}, ${moment.year}`,
      kind: moment.kind,
      memoryId: moment.memoryId,
      assetIds: moment.items.map((item) => item.id),
    });
  }

  closeSlideshow(): void {
    this.slideshowItems.set(null);
  }

  // --- Sharing ---------------------------------------------------------------

  openShare(): void {
    this.publicUrl.set(null);
    this.shareOpen.set(true);
  }

  /** A link a signed-in family member opens; a login return-URL lands them here. */
  private internalUrl(): string {
    return `${location.origin}/lookback?day=${this.day}&year=${this.year}`;
  }

  async copyInternal(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.internalUrl());
      this.toasts.success('Family link copied — they sign in and land right here.');
    } catch {
      this.toasts.error("Couldn't copy the link.");
    }
  }

  /** Snapshot the look-back's photos into a shared album and mint a public link. */
  async makePublic(): Promise<void> {
    if (this.publicBusy()) {
      return;
    }
    const assetIds = [...new Set(this.moments().flatMap((m) => m.items.map((i) => i.id)))];
    if (assetIds.length === 0) {
      return;
    }
    this.publicBusy.set(true);
    try {
      const label = new Date(`${this.year}-${this.day}T00:00:00`).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
      });
      const { albumId } = await this.albums.create(`Look-back · ${label}`, assetIds);
      // 30-day public link (revocable by deleting the album), no journal.
      const { link } = await this.sharing.createLink('album', albumId, false, 720);
      const url = `${location.origin}/s/${link.token}`;
      this.publicUrl.set(url);
      await navigator.clipboard.writeText(url).catch(() => undefined);
      this.toasts.success('Public link created and copied.');
    } catch {
      this.toasts.error("Couldn't create a public link.");
    } finally {
      this.publicBusy.set(false);
    }
  }

  async copyPublic(): Promise<void> {
    const url = this.publicUrl();
    if (!url) {
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      this.toasts.success('Public link copied.');
    } catch {
      this.toasts.error("Couldn't copy the link.");
    }
  }

  async load(): Promise<void> {
    this.loadFailed.set(false);
    this.loading.set(true);
    const params = this.route.snapshot.queryParamMap;
    const qDay = params.get('day');
    const qYear = Number(params.get('year'));
    this.day = qDay && /^\d{2}-\d{2}$/.test(qDay) ? qDay : todayMmDd();
    this.year = qYear > 1900 && qYear < 3000 ? qYear : new Date().getFullYear();
    try {
      const res = await firstValueFrom(
        this.http.get<{ moments: OnThisDayMoment[] }>(
          `/api/v1/dashboard/on-this-day?day=${this.day}&year=${this.year}&limit=6`,
        ),
      );
      this.moments.set(res.moments);
    } catch {
      this.loadFailed.set(true);
    } finally {
      this.loading.set(false);
    }
  }
}

function todayMmDd(): string {
  const now = new Date();
  return `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
