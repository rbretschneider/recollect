import { Component, inject, OnInit, signal } from '@angular/core';
import { describeError } from '../../core/describe-error';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { assetThumbUrl } from '../../core/api/photos-api.service';
import { MemoriesApiService } from '../../core/api/memories-api.service';
import { AuthStateService } from '../../core/auth/auth-state.service';
import { AppTopbar } from '../../shared/app-topbar';
import { PageLoading } from '../../shared/page-loading';
import { LoadError } from '../../shared/load-error';
import { Icon } from '../../shared/icon';
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
 * years. A moment can be relived as a slideshow (which shares from inside), or
 * turned into a real Memory to write about.
 */
@Component({
  selector: 'app-lookback-page',
  imports: [AppTopbar, PageLoading, LoadError, RouterLink, Icon, SlideshowOverlay],
  templateUrl: './lookback-page.html',
  styleUrl: './lookback-page.scss',
})
export class LookbackPage implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthStateService);
  private readonly memoriesApi = inject(MemoriesApiService);
  private readonly toasts = inject(ToastService);

  readonly moments = signal<OnThisDayMoment[]>([]);
  readonly loading = signal(true);
  readonly loadFailed = signal(false);
  readonly slideshowItems = signal<SlideItem[] | null>(null);
  readonly slideshowTitle = signal('');
  /** Key of the moment being turned into a memory, while the request runs. */
  readonly creatingMemoryKey = signal<string | null>(null);

  /** The exact look-back being viewed; the daily push links to a specific day. */
  private day = todayMmDd();
  private year = new Date().getFullYear();

  get canWrite(): boolean {
    const permission = this.auth.user()?.permission;
    return permission === 'write' || permission === 'delete';
  }

  /**
   * One tap turns a place/person moment into a Memory and opens it ready to
   * write — the title is seeded from the moment, the journal is where you land.
   */
  async makeMemory(moment: OnThisDayMoment): Promise<void> {
    if (this.creatingMemoryKey() !== null) {
      return;
    }
    this.creatingMemoryKey.set(moment.key);
    try {
      const { memoryId } = await this.memoriesApi.createMemory(
        `${moment.title}, ${moment.year}`,
        moment.items.map((item) => item.id),
      );
      await this.router.navigate(['/memories', memoryId], { queryParams: { new: 1 } });
    } catch (error) {
      this.toasts.error(describeError(error, "Couldn't create the memory."), {
        label: 'Retry',
        run: () => void this.makeMemory(moment),
      });
    } finally {
      this.creatingMemoryKey.set(null);
    }
  }

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

  /**
   * A photo was trashed from inside the show. The overlay has already dropped
   * it from the slides; take it out of the stack behind them too, so closing
   * the show doesn't reveal the photo you just deleted still sitting in the fan.
   */
  onSlideDeleted(assetId: string): void {
    this.moments.update((moments) =>
      moments
        .map((moment) => ({
          ...moment,
          items: moment.items.filter((item) => item.id !== assetId),
        }))
        // A moment that was only that photo is not a moment any more.
        .filter((moment) => moment.items.length > 0),
    );
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
