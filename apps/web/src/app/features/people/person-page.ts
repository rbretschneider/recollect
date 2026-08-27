import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { PeopleApiService, PersonFace, PersonSummary } from '../../core/api/people-api.service';
import { TimelineAsset } from '../../core/api/api-models';
import { AuthStateService } from '../../core/auth/auth-state.service';
import { EditModeService } from '../../core/edit-mode.service';
import { ConfirmService } from '../../shared/confirm.service';
import { BackButton } from '../../shared/back-button';
import { BottomNav } from '../../shared/bottom-nav';
import { PageLoading } from '../../shared/page-loading';
import { EditToggle } from '../../shared/edit-toggle';
import { AssetViewer } from '../viewer/asset-viewer';

/** One person: name them, browse their photos, and in edit mode curate the
 *  cluster — split wrong faces out, ignore junk, merge duplicates, hide. */
@Component({
  selector: 'app-person-page',
  imports: [PageLoading, BackButton, AssetViewer, BottomNav, EditToggle, FormsModule, RouterLink],
  templateUrl: './person-page.html',
  styleUrl: './person-page.scss',
})
export class PersonPage implements OnInit {
  private readonly api = inject(PeopleApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthStateService);
  private readonly confirms = inject(ConfirmService);
  protected readonly editMode = inject(EditModeService);

  readonly person = signal<PersonSummary | null>(null);
  readonly isLoaded = signal(false);
  readonly everyone = signal<PersonSummary[]>([]);
  readonly faces = signal<PersonFace[]>([]);
  readonly assetIds = signal<string[]>([]);
  readonly selectedFaceIds = signal<ReadonlySet<string>>(new Set());
  readonly viewerIndex = signal<number | null>(null);
  readonly isMergePickerOpen = signal(false);
  readonly mergeFilter = signal('');
  readonly saveState = signal<'idle' | 'saved'>('idle');
  readonly isBusy = signal(false);
  /** Mirrors the name input so suggestions react as the user types. */
  readonly nameQuery = signal('');

  nameDraft = '';

  readonly title = computed(() => this.person()?.name ?? 'Who’s this?');

  /**
   * Existing named people matching what's being typed — the same kid years
   * apart clusters separately, so typing their name offers to combine.
   */
  readonly nameSuggestions = computed(() => {
    const needle = this.nameQuery().trim().toLowerCase();
    const self = this.person();
    if (needle.length === 0 || needle === (self?.name ?? '').toLowerCase()) {
      return [];
    }
    return this.everyone()
      .filter(
        (candidate) =>
          candidate.id !== self?.id &&
          candidate.name !== null &&
          candidate.name.toLowerCase().includes(needle),
      )
      .slice(0, 5);
  });

  readonly mergeCandidates = computed(() => {
    const needle = this.mergeFilter().trim().toLowerCase();
    const selfId = this.person()?.id;
    return this.everyone()
      .filter((candidate) => candidate.id !== selfId)
      .filter(
        (candidate) =>
          needle.length === 0 || (candidate.name ?? '').toLowerCase().includes(needle),
      );
  });

  get canWrite(): boolean {
    const permission = this.auth.user()?.permission;
    return permission === 'write' || permission === 'delete';
  }

  ngOnInit(): void {
    // Split/merge navigate between person ids without leaving the component.
    this.route.paramMap.subscribe(() => void this.load());
  }

  thumbUrl(assetId: string): string {
    return `/api/v1/assets/${assetId}/thumb/240`;
  }

  cropUrl(faceId: string): string {
    return this.api.faceCropUrl(faceId);
  }

  async saveName(): Promise<void> {
    const person = this.person();
    const name = this.nameDraft.trim();
    if (!person || name.length === 0 || name === person.name) {
      return;
    }
    const wasUnnamed = person.name === null;
    await this.api.rename(person.id, name);
    this.person.set({ ...person, name });
    this.nameQuery.set('');
    this.saveState.set('saved');
    if (wasUnnamed) {
      // First naming answers "who's this?" — float back out to the People list.
      setTimeout(() => void this.router.navigateByUrl('/people'), 900);
      return;
    }
    setTimeout(() => this.saveState.set('idle'), 2000);
  }

  toggleFace(faceId: string): void {
    this.selectedFaceIds.update((current) => {
      const next = new Set(current);
      if (next.has(faceId)) {
        next.delete(faceId);
      } else {
        next.add(faceId);
      }
      return next;
    });
  }

  /** "Not the same person": selected faces move to a brand-new person. */
  async splitSelected(): Promise<void> {
    const person = this.person();
    const faceIds = [...this.selectedFaceIds()];
    if (!person || faceIds.length === 0 || this.isBusy()) {
      return;
    }
    this.isBusy.set(true);
    try {
      const { personId } = await this.api.split(person.id, faceIds);
      await this.router.navigate(['/people', personId]);
    } finally {
      this.isBusy.set(false);
    }
  }

  /** Ignored faces disappear from People entirely (not a person / junk detection). */
  async ignoreSelected(): Promise<void> {
    const faceIds = [...this.selectedFaceIds()];
    if (faceIds.length === 0 || this.isBusy()) {
      return;
    }
    const confirmed = await this.confirms.ask({
      title: `Ignore ${faceIds.length === 1 ? 'this face' : `these ${faceIds.length} faces`}?`,
      message: 'Ignored faces disappear from People for good. The photos themselves stay put.',
      confirmLabel: 'Ignore',
    });
    if (!confirmed) {
      return;
    }
    this.isBusy.set(true);
    try {
      await this.api.ignoreFaces(faceIds);
      this.selectedFaceIds.set(new Set());
      await this.load();
    } finally {
      this.isBusy.set(false);
    }
  }

  async mergeInto(target: PersonSummary): Promise<void> {
    const person = this.person();
    if (!person || this.isBusy()) {
      return;
    }
    const label = target.name ?? 'this unnamed person';
    const confirmed = await this.confirms.ask({
      title: `Merge into ${label}?`,
      message: `All ${person.faceCount} photos of “${this.title()}” will belong to ${label}. This can't be undone.`,
      confirmLabel: 'Merge',
      danger: false,
    });
    if (!confirmed) {
      return;
    }
    this.isBusy.set(true);
    try {
      await this.api.mergeInto(person.id, target.id);
      this.isMergePickerOpen.set(false);
      await this.router.navigate(['/people', target.id]);
    } finally {
      this.isBusy.set(false);
    }
  }

  async hidePerson(): Promise<void> {
    const person = this.person();
    if (!person) {
      return;
    }
    const confirmed = await this.confirms.ask({
      title: 'Hide this person?',
      message: 'They disappear from People. Their photos stay in the library.',
      confirmLabel: 'Hide',
    });
    if (!confirmed) {
      return;
    }
    await this.api.hide(person.id);
    await this.router.navigateByUrl('/people');
  }

  openViewer(index: number): void {
    this.viewerIndex.set(index);
  }

  closeViewer(): void {
    this.viewerIndex.set(null);
  }

  /** The viewer trashed a photo: it leaves this person's grid too. */
  onViewerDeleted(assetId: string): void {
    this.assetIds.update((ids) => ids.filter((id) => id !== assetId));
  }

  viewerAssets(): TimelineAsset[] {
    return this.assetIds().map((id) => ({
      id,
      mediaType: 'image' as const,
      capturedAt: new Date(0).toISOString(),
      capturedDay: '',
      width: null,
      height: null,
      durationMs: null,
      hasThumbnail: true,
      isFavorite: false,
    }));
  }

  private async load(): Promise<void> {
    const personId = this.route.snapshot.paramMap.get('id');
    if (!personId) {
      return;
    }
    this.selectedFaceIds.set(new Set());
    const [{ people }, { assetIds }, { faces }] = await Promise.all([
      this.api.list(),
      this.api.getAssets(personId),
      this.api.getFaces(personId),
    ]);
    const person = people.find((candidate) => candidate.id === personId) ?? null;
    this.person.set(person);
    this.everyone.set(people);
    this.nameDraft = person?.name ?? '';
    this.assetIds.set(assetIds);
    this.faces.set(faces);
    this.isLoaded.set(true);
  }
}
