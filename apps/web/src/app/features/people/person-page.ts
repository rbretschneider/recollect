import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { assetThumbUrl } from '../../core/api/photos-api.service';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { PeopleApiService, PersonFace, PersonSummary } from '../../core/api/people-api.service';
import { TimelineAsset, toViewerAsset } from '../../core/api/api-models';
import { AuthStateService } from '../../core/auth/auth-state.service';
import { EditModeService } from '../../core/edit-mode.service';
import { ConfirmService } from '../../shared/confirm.service';
import { AccountBadge } from '../../shared/account-badge';
import { MenuButton } from '../../shared/menu-button';
import { BackButton } from '../../shared/back-button';
import { PageLoading } from '../../shared/page-loading';
import { LoadError } from '../../shared/load-error';
import { ToastService } from '../../shared/toast.service';
import { EditToggle } from '../../shared/edit-toggle';

import { AssetViewer } from '../viewer/asset-viewer';

/** One person: name them, browse their photos, and in edit mode curate the
 *  cluster — split wrong faces out, ignore junk, merge duplicates, hide. */
@Component({
  selector: 'app-person-page',
  imports: [AccountBadge, MenuButton, PageLoading, BackButton, AssetViewer, EditToggle, FormsModule, RouterLink, LoadError],
  templateUrl: './person-page.html',
  styleUrl: './person-page.scss',
})
export class PersonPage implements OnInit {
  private readonly api = inject(PeopleApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthStateService);
  private readonly confirms = inject(ConfirmService);
  private readonly toasts = inject(ToastService);
  protected readonly editMode = inject(EditModeService);

  readonly person = signal<PersonSummary | null>(null);
  readonly isLoaded = signal(false);
  readonly loadFailed = signal(false);
  readonly everyone = signal<PersonSummary[]>([]);
  readonly faces = signal<PersonFace[]>([]);
  readonly assetIds = signal<string[]>([]);
  readonly selectedFaceIds = signal<ReadonlySet<string>>(new Set());
  readonly viewerIndex = signal<number | null>(null);
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


  /** Face curation (naming, merging, splitting) is admin territory. */
  get canWrite(): boolean {
    return this.auth.user()?.isAdmin ?? false;
  }

  ngOnInit(): void {
    // Split/merge navigate between person ids without leaving the component.
    this.route.paramMap.subscribe(() => void this.load());
  }

  thumbUrl(assetId: string): string {
    return assetThumbUrl(assetId);
  }

  cropUrl(faceId: string): string {
    return this.api.faceCropUrl(faceId);
  }

  async saveName(): Promise<void> {
    const person = this.person();
    const name = this.nameDraft.trim();
    if (!person || name.length === 0 || name === person.name || this.isBusy()) {
      return;
    }
    const wasUnnamed = person.name === null;
    this.isBusy.set(true);
    try {
      await this.api.rename(person.id, name);
    } catch {
      // Don't flash "Saved ✓" — keep the name editable so they can retry.
      this.toasts.error("Couldn't save the name.", { label: 'Retry', run: () => void this.saveName() });
      return;
    } finally {
      this.isBusy.set(false);
    }
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

  /**
   * Opens the photo a face was found in — a tiny background face crop can
   * look like a total stranger until you see where it came from.
   */
  viewSelectedFacePhoto(): void {
    const [faceId] = [...this.selectedFaceIds()];
    if (!faceId || this.selectedFaceIds().size !== 1) {
      return;
    }
    const assetId = this.faces().find((face) => face.id === faceId)?.assetId;
    const index = assetId ? this.assetIds().indexOf(assetId) : -1;
    if (index >= 0) {
      this.viewerIndex.set(index);
    }
  }

  /** Pins the one selected face as this person's avatar app-wide. */
  async useSelectedAsAvatar(): Promise<void> {
    const person = this.person();
    const [faceId] = [...this.selectedFaceIds()];
    if (!person || !faceId || this.selectedFaceIds().size !== 1 || this.isBusy()) {
      return;
    }
    this.isBusy.set(true);
    try {
      await this.api.setCoverFace(person.id, faceId);
      this.selectedFaceIds.set(new Set());
      await this.load();
    } catch {
      this.toasts.error("Couldn't set the avatar.");
    } finally {
      this.isBusy.set(false);
    }
  }

  /** Detaches the selected faces back into the pool; they re-cluster elsewhere. */
  async removeSelected(): Promise<void> {
    const person = this.person();
    const faceIds = [...this.selectedFaceIds()];
    if (!person || faceIds.length === 0 || this.isBusy()) {
      return;
    }
    this.isBusy.set(true);
    try {
      await this.api.removeFaces(person.id, faceIds);
      this.selectedFaceIds.set(new Set());
      await this.load();
    } catch {
      this.toasts.error("Couldn't remove those faces.");
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
      await this.router.navigate(['/people', target.id]);
    } catch {
      this.toasts.error("Couldn't merge these people.");
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
    try {
      await this.api.hide(person.id);
      await this.router.navigateByUrl('/people');
    } catch {
      this.toasts.error("Couldn't hide this person.");
    }
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

  /** computed: the viewer needs a STABLE array — a method here would rebuild
   *  it every change detection and permanently reset the viewer's spinner. */
  readonly viewerAssets = computed<TimelineAsset[]>(() =>
    this.assetIds().map((id) => toViewerAsset(id)),
  );

  protected async load(): Promise<void> {
    const personId = this.route.snapshot.paramMap.get('id');
    if (!personId) {
      return;
    }
    this.loadFailed.set(false);
    this.selectedFaceIds.set(new Set());
    try {
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
    } catch {
      this.loadFailed.set(true);
    }
  }
}
