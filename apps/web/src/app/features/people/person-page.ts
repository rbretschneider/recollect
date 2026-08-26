import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { PeopleApiService, PersonFace, PersonSummary } from '../../core/api/people-api.service';
import { TimelineAsset } from '../../core/api/api-models';
import { AuthStateService } from '../../core/auth/auth-state.service';
import { EditModeService } from '../../core/edit-mode.service';
import { BottomNav } from '../../shared/bottom-nav';
import { EditToggle } from '../../shared/edit-toggle';
import { AssetViewer } from '../viewer/asset-viewer';

/** One person: name them, browse their photos, and in edit mode curate the
 *  cluster — split wrong faces out, ignore junk, merge duplicates, hide. */
@Component({
  selector: 'app-person-page',
  imports: [AssetViewer, BottomNav, EditToggle, FormsModule, RouterLink],
  templateUrl: './person-page.html',
  styleUrl: './person-page.scss',
})
export class PersonPage implements OnInit {
  private readonly api = inject(PeopleApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthStateService);
  protected readonly editMode = inject(EditModeService);

  readonly person = signal<PersonSummary | null>(null);
  readonly everyone = signal<PersonSummary[]>([]);
  readonly faces = signal<PersonFace[]>([]);
  readonly assetIds = signal<string[]>([]);
  readonly selectedFaceIds = signal<ReadonlySet<string>>(new Set());
  readonly viewerIndex = signal<number | null>(null);
  readonly isMergePickerOpen = signal(false);
  readonly mergeFilter = signal('');
  readonly saveState = signal<'idle' | 'saved'>('idle');
  readonly isBusy = signal(false);

  nameDraft = '';

  readonly title = computed(() => this.person()?.name ?? 'Who’s this?');

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
    await this.api.rename(person.id, name);
    this.person.set({ ...person, name });
    this.saveState.set('saved');
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
    if (!confirm(`Merge all ${person.faceCount} photos of "${this.title()}" into ${label}?`)) {
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
    if (!confirm('Hide this person from People? Their photos stay in the library.')) {
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
  }
}
