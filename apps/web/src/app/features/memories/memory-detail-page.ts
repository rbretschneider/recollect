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
import { assetThumbUrl } from '../../core/api/photos-api.service';
import { formatDateSpan } from '../../core/format-date';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MemoriesApiService } from '../../core/api/memories-api.service';
import { PhotosApiService } from '../../core/api/photos-api.service';
import { SharingApiService } from '../../core/api/sharing-api.service';
import { PeopleApiService, PersonSummary } from '../../core/api/people-api.service';
import { MemoryDetail, MemoryQuote, TimelineAsset } from '../../core/api/api-models';
import { AuthStateService } from '../../core/auth/auth-state.service';
import { EditModeService } from '../../core/edit-mode.service';
import { AccountBadge } from '../../shared/account-badge';
import { MenuButton } from '../../shared/menu-button';
import { BackButton } from '../../shared/back-button';
import { PageLoading } from '../../shared/page-loading';
import { LoadError } from '../../shared/load-error';
import { ToastService } from '../../shared/toast.service';
import { ConfirmService } from '../../shared/confirm.service';
import { EditToggle } from '../../shared/edit-toggle';
import { Icon } from '../../shared/icon';
import { SafeResourcePipe } from '../../shared/safe-resource.pipe';
import { ShareButton } from '../../shared/share-button';
import { AssetViewer } from '../viewer/asset-viewer';
import { SlideItem, SlideshowOverlay } from '../dashboard/slideshow-overlay';

const JOURNAL_AUTOSAVE_MS = 1500;

/** One Memory: hero, editable title, media grid, and the journal. */
@Component({
  selector: 'app-memory-detail-page',
  imports: [AccountBadge, MenuButton, PageLoading, LoadError, BackButton,
    AssetViewer,
    SlideshowOverlay,
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
  private readonly photosApi = inject(PhotosApiService);
  private readonly sharingApi = inject(SharingApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthStateService);
  private readonly confirms = inject(ConfirmService);
  private readonly toasts = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly editMode = inject(EditModeService);

  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly editor = viewChild<ElementRef<HTMLTextAreaElement>>('editor');

  readonly detail = signal<MemoryDetail | null>(null);
  readonly loadFailed = signal(false);
  readonly viewerAssets = signal<TimelineAsset[]>([]);
  readonly viewerIndex = signal<number | null>(null);
  readonly isEditingTitle = signal(false);
  readonly journalDraft = signal('');
  readonly saveState = signal<'idle' | 'saving' | 'saved' | 'error'>('idle');
  /** Reveal the collapsed "help identify" faces in Who was there. */
  readonly showUnidentified = signal(false);
  /** "Public until Sep 4" / "Public — no expiration" when a share link is live. */
  readonly shareBadge = signal<string | null>(null);
  titleDraft = '';

  /** Named attendees — the guest list, always shown. */
  readonly attendeesNamed = computed(() => this.detail()?.people.filter((p) => p.name !== null) ?? []);
  /** Recurring but still-unnamed faces — collapsed behind a "help identify" toggle. */
  readonly attendeesUnnamed = computed(() => this.detail()?.people.filter((p) => p.name === null) ?? []);
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

  /**
   * The read-mode story: captioned photos in memory order, with adjacent shots
   * that share a caption merged into one group (select three climbing photos,
   * write "the rocks were sweet" once, and they read as a single captioned
   * beat). Uncaptioned photos fall through to the end stack.
   */
  readonly storyGroups = computed<Array<{ caption: string; assetIds: string[] }>>(() => {
    const detail = this.detail();
    if (!detail) {
      return [];
    }
    // Group every photo that shares a caption, wherever they sit in the memory,
    // and place the group at its first photo — so selecting three climbing
    // shots for "the rocks were sweet" reads as one beat even if they're not
    // strictly adjacent.
    const byCaption = new Map<string, string[]>();
    for (const id of detail.assetIds) {
      const caption = detail.captions[id];
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

  /** Photos with no caption — shown at the end as a tappable polaroid stack. */
  readonly looseAssetIds = computed<string[]>(() => {
    const detail = this.detail();
    return detail ? detail.assetIds.filter((id) => !detail.captions[id]) : [];
  });

  /** Up to four fanned previews for the end-of-story stack. */
  readonly loosePreview = computed<string[]>(() => this.looseAssetIds().slice(0, 4));

  /** My journal entry split into paragraphs (blank-line separated). */
  readonly journalParagraphs = computed<string[]>(() => {
    const text = this.journalDraft().trim();
    return text ? text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean) : [];
  });

  /**
   * The read-mode story woven together: journal paragraphs with captioned photo
   * groups nestled into the gaps between them. How many nestle inline is set by
   * the prose itself — at most one per paragraph, spread evenly — so a longer
   * entry pulls more photos into the text and a short one keeps just a couple.
   * Groups that don't fit inline follow after the prose; uncaptioned photos go
   * to the end stack. With no prose, every group simply renders as a figure.
   */
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
    // Fancy math: nestle up to one figure per paragraph, placed at evenly spaced
    // gaps. Figure i lands after paragraph floor((i+1)·P / (inline+1)).
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
    // Any captioned groups beyond the prose's capacity trail after it.
    for (let i = inlineCount; i < groups.length; i++) {
      flow.push({ kind: 'figure', ...groups[i] });
    }
    return flow;
  });

  // --- Edit-mode captioning: select any number of photos, caption them once ---

  /** Photos currently selected for a shared caption. */
  readonly captionSelection = signal<ReadonlySet<string>>(new Set());
  /** The caption being written for the current selection. */
  captionGroupDraft = '';

  /** Tap a photo to add/remove it from the caption selection. */
  toggleCaptionSelect(assetId: string): void {
    const detail = this.detail();
    this.captionSelection.update((current) => {
      const next = new Set(current);
      if (next.has(assetId)) {
        next.delete(assetId);
      } else {
        next.add(assetId);
      }
      return next;
    });
    // Prefill with the selection's shared caption (empty when they differ), so
    // reopening a group lets you edit its text instead of retyping.
    if (detail) {
      const caps = new Set([...this.captionSelection()].map((id) => detail.captions[id] ?? ''));
      this.captionGroupDraft = caps.size === 1 ? [...caps][0] : '';
    }
  }

  /** Writes the drafted caption onto every selected photo (blank clears them). */
  async applyGroupCaption(): Promise<void> {
    const detail = this.detail();
    const ids = [...this.captionSelection()];
    if (!detail || ids.length === 0) {
      return;
    }
    const text = this.captionGroupDraft.trim();
    await Promise.all(ids.map((id) => this.api.setCaption(detail.id, id, text)));
    const captions = { ...detail.captions };
    for (const id of ids) {
      if (text.length > 0) {
        captions[id] = text;
      } else {
        delete captions[id];
      }
    }
    this.detail.set({ ...detail, captions });
    this.captionSelection.set(new Set());
    this.captionGroupDraft = '';
  }

  /** Clears the current caption selection without changing anything. */
  clearCaptionSelection(): void {
    this.captionSelection.set(new Set());
    this.captionGroupDraft = '';
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
    return assetThumbUrl(assetId, size);
  }

  cropUrl(faceId: string): string {
    return this.peopleApi.faceCropUrl(faceId);
  }

  coverUrl(detail: MemoryDetail): string | null {
    return detail.coverAssetId ? assetThumbUrl(detail.coverAssetId, 1440) : null;
  }

  formatSpan(detail: MemoryDetail): string {
    return formatDateSpan(detail.startAt, detail.endAt);
  }

  startEditingTitle(): void {
    if (!this.editMode.isEditing()) {
      return;
    }
    this.titleDraft = this.detail()?.title ?? '';
    this.isEditingTitle.set(true);
  }

  /** Share status is a garnish — fire-and-forget, never blocking the memory.
   *  Read-only users get a 403 and simply see no badge. */
  refreshShareBadge(memoryId: string): void {
    void this.sharingApi
      .listFor('memory', memoryId)
      .then(({ links }) => {
        const share = links[0];
        this.shareBadge.set(
          share
            ? share.expiresAt === null
              ? 'Public — no expiration'
              : `Public until ${new Date(share.expiresAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
            : null,
        );
      })
      .catch(() => this.shareBadge.set(null));
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

  protected async load(): Promise<void> {
    const memoryId = this.route.snapshot.paramMap.get('id');
    if (!memoryId) {
      return;
    }
    this.loadFailed.set(false);
    try {
      const detail = await this.api.getMemory(memoryId);
      this.detail.set(detail);
      // Seed the title field so edit mode can show it editable immediately.
      this.titleDraft = detail.title;
      this.refreshShareBadge(memoryId);
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
    } catch {
      this.loadFailed.set(true);
    }
  }

  private async saveJournal(): Promise<void> {
    const detail = this.detail();
    if (!detail) {
      return;
    }
    try {
      await this.api.writeJournal(detail.id, this.journalDraft());
      this.saveState.set('saved');
    } catch {
      // Never leave the byline stuck on "Saving…" over unsaved text.
      this.saveState.set('error');
      this.toasts.error('Couldn’t save your journal.', { label: 'Retry', run: () => void this.saveJournal() });
    }
  }

  private flushJournalSave(): void {
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
      void this.saveJournal();
    }
  }

  /** The viewer needs TimelineAsset shapes; one batch request loads them all. */
  private async loadViewerAssets(assetIds: string[]): Promise<void> {
    this.viewerAssets.set(await this.photosApi.items(assetIds));
  }

  /** The whole memory as a music-backed slideshow (real media types). */
  readonly slideshowItems = signal<SlideItem[] | null>(null);

  async openSlideshow(): Promise<void> {
    const detail = this.detail();
    if (!detail) {
      return;
    }
    if (this.viewerAssets().length === 0) {
      await this.loadViewerAssets(detail.assetIds);
    }
    this.slideshowItems.set(
      this.viewerAssets().map((asset) => ({
        id: asset.id,
        mediaType: asset.mediaType,
        caption: detail.captions[asset.id],
      })),
    );
  }
}
