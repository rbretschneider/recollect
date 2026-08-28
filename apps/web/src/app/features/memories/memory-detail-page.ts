import {
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  OnInit,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { MemoriesApiService } from '../../core/api/memories-api.service';
import { PeopleApiService, PersonSummary } from '../../core/api/people-api.service';
import { MemoryDetail, MemoryQuote, TimelineAsset } from '../../core/api/api-models';
import { AuthStateService } from '../../core/auth/auth-state.service';
import { EditModeService } from '../../core/edit-mode.service';
import { BackButton } from '../../shared/back-button';
import { PageLoading } from '../../shared/page-loading';
import { ConfirmService } from '../../shared/confirm.service';
import { EditToggle } from '../../shared/edit-toggle';
import { Icon } from '../../shared/icon';
import { SafeResourcePipe } from '../../shared/safe-resource.pipe';
import { ShareButton } from '../../shared/share-button';
import { AssetViewer } from '../viewer/asset-viewer';

const JOURNAL_AUTOSAVE_MS = 1500;

/** One Memory: hero, editable title, media grid, and the journal. */
@Component({
  selector: 'app-memory-detail-page',
  imports: [PageLoading, BackButton, 
    AssetViewer,

    EditToggle,
    FormsModule,
    Icon,
    RouterLink,
    SafeResourcePipe,
    ShareButton,
  ],
  templateUrl: './memory-detail-page.html',
  styleUrl: './memory-detail-page.scss',
})
export class MemoryDetailPage implements OnInit {
  private readonly api = inject(MemoriesApiService);
  private readonly peopleApi = inject(PeopleApiService);
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthStateService);
  private readonly confirms = inject(ConfirmService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly editMode = inject(EditModeService);

  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly editor = viewChild<ElementRef<HTMLTextAreaElement>>('editor');

  readonly detail = signal<MemoryDetail | null>(null);
  readonly viewerAssets = signal<TimelineAsset[]>([]);
  readonly viewerIndex = signal<number | null>(null);
  readonly isEditingTitle = signal(false);
  readonly journalDraft = signal('');
  readonly saveState = signal<'idle' | 'saving' | 'saved'>('idle');
  titleDraft = '';
  quoteTextDraft = '';
  quoteSaidByDraft = '';
  /** Person explicitly picked from the who-said-it typeahead. */
  quoteSaidByPersonId: string | null = null;
  /** Mirrors the who-said-it input so the typeahead reacts. */
  readonly saidByQuery = signal('');
  private readonly namedPeople = signal<PersonSummary[]>([]);
  private peopleLoaded = false;

  readonly saidBySuggestions = computed(() => {
    const needle = this.saidByQuery().trim().toLowerCase();
    if (needle.length === 0) {
      return [];
    }
    return this.namedPeople()
      .filter((candidate) => candidate.name?.toLowerCase().includes(needle))
      .slice(0, 4);
  });

  get canSubmitQuote(): boolean {
    return this.quoteTextDraft.trim().length > 0 && this.quoteSaidByDraft.trim().length > 0;
  }

  /** Typing again unlinks; a fresh pick (or server auto-match) relinks. */
  onSaidByInput(value: string): void {
    this.quoteSaidByPersonId = null;
    this.saidByQuery.set(value);
    if (!this.peopleLoaded) {
      this.peopleLoaded = true;
      void this.peopleApi.list().then(({ people }) => {
        this.namedPeople.set(people.filter((entry) => entry.name !== null));
      });
    }
  }

  pickSaidBy(candidate: PersonSummary): void {
    this.quoteSaidByDraft = candidate.name ?? '';
    this.quoteSaidByPersonId = candidate.id;
    this.saidByQuery.set('');
  }

  readonly myJournalEntry = computed(() => {
    const userId = this.auth.user()?.id;
    return this.detail()?.journal.find((entry) => entry.authorUserId === userId) ?? null;
  });

  readonly othersJournalEntries = computed(() => {
    const userId = this.auth.user()?.id;
    return this.detail()?.journal.filter((entry) => entry.authorUserId !== userId) ?? [];
  });

  /** Which caption just saved, for the flash of confirmation. */
  readonly captionJustSaved = signal<string | null>(null);

  /** Captioned photos, in album order — the story's inline figures. */
  readonly storyMoments = computed<Array<{ assetId: string; caption: string }>>(() => {
    const detail = this.detail();
    if (!detail) {
      return [];
    }
    return detail.assetIds
      .filter((id) => detail.captions[id])
      .map((assetId) => ({ assetId, caption: detail.captions[assetId] }));
  });

  /** Saves one photo's scrapbook caption as soon as the field settles. */
  async saveCaption(assetId: string, value: string): Promise<void> {
    const detail = this.detail();
    if (!detail) {
      return;
    }
    await this.api.setCaption(detail.id, assetId, value);
    this.captionJustSaved.set(assetId);
    setTimeout(() => {
      if (this.captionJustSaved() === assetId) {
        this.captionJustSaved.set(null);
      }
    }, 1500);
    const captions = { ...detail.captions };
    if (value.trim().length > 0) {
      captions[assetId] = value.trim();
    } else {
      delete captions[assetId];
    }
    this.detail.set({ ...detail, captions });
  }

  /** Whether the journal section has anything to show in read mode. */
  get hasJournalContent(): boolean {
    return this.journalDraft().trim().length > 0 || this.othersJournalEntries().length > 0;
  }

  get myName(): string {
    return this.auth.user()?.displayName ?? 'Me';
  }

  get canWrite(): boolean {
    const permission = this.auth.user()?.permission;
    return permission === 'write' || permission === 'delete';
  }

  ngOnInit(): void {
    this.destroyRef.onDestroy(() => this.flushJournalSave());
    // A memory just created from a selection or album opens ready to write.
    if (this.route.snapshot.queryParamMap.get('new') === '1') {
      this.editMode.enter();
    }
    void this.load();
  }

  thumbUrl(assetId: string, size: 240 | 720 | 1440 = 240): string {
    return `/api/v1/assets/${assetId}/thumb/${size}`;
  }

  cropUrl(faceId: string): string {
    return this.peopleApi.faceCropUrl(faceId);
  }

  coverUrl(detail: MemoryDetail): string | null {
    return detail.coverAssetId ? `/api/v1/assets/${detail.coverAssetId}/thumb/1440` : null;
  }

  formatSpan(detail: MemoryDetail): string {
    const start = new Date(detail.startAt);
    const end = new Date(detail.endAt);
    const format = new Intl.DateTimeFormat(undefined, {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
    return start.toDateString() === end.toDateString()
      ? format.format(start)
      : `${format.format(start)} – ${format.format(end)}`;
  }

  startEditingTitle(): void {
    if (!this.editMode.isEditing()) {
      return;
    }
    this.titleDraft = this.detail()?.title ?? '';
    this.isEditingTitle.set(true);
  }

  async saveTitle(): Promise<void> {
    const detail = this.detail();
    const title = this.titleDraft.trim();
    this.isEditingTitle.set(false);
    if (!detail || title.length === 0 || title === detail.title) {
      return;
    }
    this.detail.set({ ...detail, title });
    await this.api.updateMemory(detail.id, { title });
  }

  onJournalInput(value: string): void {
    this.journalDraft.set(value);
    this.saveState.set('saving');
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
    }
    this.saveTimer = setTimeout(() => void this.saveJournal(), JOURNAL_AUTOSAVE_MS);
  }

  /** OSM embed URL centered on the memory's median photo location. */
  mapEmbedUrl(detail: MemoryDetail): string | null {
    if (detail.gpsLat === null || detail.gpsLon === null) {
      return null;
    }
    const delta = 0.02;
    const bbox = [
      detail.gpsLon - delta,
      detail.gpsLat - delta,
      detail.gpsLon + delta,
      detail.gpsLat + delta,
    ].join('%2C');
    return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${detail.gpsLat}%2C${detail.gpsLon}`;
  }

  googleMapsUrl(detail: MemoryDetail): string {
    return `https://www.google.com/maps?q=${detail.gpsLat},${detail.gpsLon}`;
  }

  async deleteMemory(): Promise<void> {
    const detail = this.detail();
    if (!detail) {
      return;
    }
    const confirmed = await this.confirms.ask({
      title: `Delete “${detail.title}”?`,
      message: 'The memory and its journal go away for good. Your photos are not affected.',
      confirmLabel: 'Delete memory',
    });
    if (!confirmed) {
      return;
    }
    await this.api.deleteMemory(detail.id);
    await this.router.navigateByUrl('/memories');
  }

  /** The filmstrip runs at a fixed height; 720 keeps frames sharp. */
  stripThumbUrl(assetId: string): string {
    return `/api/v1/assets/${assetId}/thumb/720`;
  }

  async addQuote(): Promise<void> {
    const detail = this.detail();
    if (!detail || !this.canSubmitQuote) {
      return;
    }
    const { quote } = await this.api.addQuote(
      detail.id,
      this.quoteTextDraft.trim(),
      this.quoteSaidByDraft.trim(),
      this.quoteSaidByPersonId ?? undefined,
    );
    this.detail.set({ ...detail, quotes: [...detail.quotes, quote] });
    this.quoteTextDraft = '';
    this.quoteSaidByDraft = '';
    this.quoteSaidByPersonId = null;
    this.saidByQuery.set('');
  }

  async deleteQuote(quote: MemoryQuote): Promise<void> {
    const detail = this.detail();
    if (!detail) {
      return;
    }
    const confirmed = await this.confirms.ask({
      title: 'Delete this quote?',
      message: `“${quote.text.slice(0, 80)}${quote.text.length > 80 ? '…' : ''}” goes away for good.`,
      confirmLabel: 'Delete quote',
    });
    if (!confirmed) {
      return;
    }
    await this.api.deleteQuote(detail.id, quote.id);
    this.detail.set({ ...detail, quotes: detail.quotes.filter((entry) => entry.id !== quote.id) });
  }

  /** The journal grows with the writing instead of scrolling inside a box. */
  autoGrow(element: HTMLTextAreaElement): void {
    element.style.height = 'auto';
    element.style.height = `${element.scrollHeight}px`;
  }

  async openViewer(assetId: string): Promise<void> {
    const detail = this.detail();
    if (!detail) {
      return;
    }
    if (this.viewerAssets().length === 0) {
      await this.loadViewerAssets(detail.assetIds);
    }
    const index = this.viewerAssets().findIndex((asset) => asset.id === assetId);
    if (index >= 0) {
      this.viewerIndex.set(index);
    }
  }

  closeViewer(): void {
    this.viewerIndex.set(null);
  }

  /** The viewer trashed a photo: it leaves this memory's grid too. */
  onViewerDeleted(assetId: string): void {
    const detail = this.detail();
    if (detail) {
      this.detail.set({ ...detail, assetIds: detail.assetIds.filter((id) => id !== assetId) });
    }
    this.viewerAssets.update((assets) => assets.filter((asset) => asset.id !== assetId));
  }

  private async load(): Promise<void> {
    const memoryId = this.route.snapshot.paramMap.get('id');
    if (!memoryId) {
      return;
    }
    const detail = await this.api.getMemory(memoryId);
    this.detail.set(detail);
    this.journalDraft.set(
      detail.journal.find((entry) => entry.authorUserId === this.auth.user()?.id)?.bodyMd ?? '',
    );
    // Existing writing must be fully visible, not clipped at the min height.
    setTimeout(() => {
      const element = this.editor()?.nativeElement;
      if (element) {
        this.autoGrow(element);
      }
    });
  }

  private async saveJournal(): Promise<void> {
    const detail = this.detail();
    if (!detail) {
      return;
    }
    await this.api.writeJournal(detail.id, this.journalDraft());
    this.saveState.set('saved');
  }

  private flushJournalSave(): void {
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
      void this.saveJournal();
    }
  }

  /** The viewer needs TimelineAsset shapes; one batch request loads them all. */
  private async loadViewerAssets(assetIds: string[]): Promise<void> {
    const { items } = await firstValueFrom(
      this.http.post<{ items: TimelineAsset[] }>('/api/v1/assets/items', { assetIds }),
    );
    this.viewerAssets.set(items);
  }

}
