import { Component, inject, OnInit, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { assetThumbUrl } from '../../core/api/photos-api.service';
import { AppTopbar } from '../../shared/app-topbar';
import { PageLoading } from '../../shared/page-loading';
import { LoadError } from '../../shared/load-error';
import { Icon } from '../../shared/icon';
import { SlideshowOverlay, SlideItem } from '../dashboard/slideshow-overlay';

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
 * years, a few more than the home page shows. Same moment cards, dedicated view.
 */
@Component({
  selector: 'app-lookback-page',
  imports: [AppTopbar, PageLoading, LoadError, RouterLink, Icon, SlideshowOverlay],
  templateUrl: './lookback-page.html',
  styleUrl: './lookback-page.scss',
})
export class LookbackPage implements OnInit {
  private readonly http = inject(HttpClient);

  readonly moments = signal<OnThisDayMoment[]>([]);
  readonly loading = signal(true);
  readonly loadFailed = signal(false);
  readonly slideshowItems = signal<SlideItem[] | null>(null);
  readonly slideshowTitle = signal('');

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

  openSlideshow(moment: OnThisDayMoment): void {
    this.slideshowTitle.set(`${moment.title} · ${this.yearsAgo(moment.year)}`);
    this.slideshowItems.set(moment.items);
  }

  closeSlideshow(): void {
    this.slideshowItems.set(null);
  }

  async load(): Promise<void> {
    this.loadFailed.set(false);
    this.loading.set(true);
    const now = new Date();
    const day = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    try {
      const res = await firstValueFrom(
        this.http.get<{ moments: OnThisDayMoment[] }>(
          `/api/v1/dashboard/on-this-day?day=${day}&year=${now.getFullYear()}&limit=6`,
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
