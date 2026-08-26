import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { PeopleApiService, PersonSummary } from '../../core/api/people-api.service';
import { TimelineAsset } from '../../core/api/api-models';
import { AuthStateService } from '../../core/auth/auth-state.service';
import { BottomNav } from '../../shared/bottom-nav';
import { AssetViewer } from '../viewer/asset-viewer';

/** One person: name them, browse every photo they appear in. */
@Component({
  selector: 'app-person-page',
  imports: [AssetViewer, BottomNav, FormsModule, RouterLink],
  templateUrl: './person-page.html',
  styleUrl: './person-page.scss',
})
export class PersonPage implements OnInit {
  private readonly api = inject(PeopleApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly auth = inject(AuthStateService);

  readonly person = signal<PersonSummary | null>(null);
  readonly assetIds = signal<string[]>([]);
  readonly viewerIndex = signal<number | null>(null);
  readonly saveState = signal<'idle' | 'saved'>('idle');

  nameDraft = '';

  readonly title = computed(() => this.person()?.name ?? 'Who’s this?');

  get canWrite(): boolean {
    const permission = this.auth.user()?.permission;
    return permission === 'write' || permission === 'delete';
  }

  ngOnInit(): void {
    void this.load();
  }

  thumbUrl(assetId: string): string {
    return `/api/v1/assets/${assetId}/thumb/240`;
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
    const [{ people }, { assetIds }] = await Promise.all([
      this.api.list(),
      this.api.getAssets(personId),
    ]);
    const person = people.find((candidate) => candidate.id === personId) ?? null;
    this.person.set(person);
    this.nameDraft = person?.name ?? '';
    this.assetIds.set(assetIds);
  }
}
