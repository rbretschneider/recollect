import {
  Component,
  DestroyRef,
  ElementRef,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AssetCaption } from '../../core/api/api-models';
import { AssetCaptionsApiService, CaptionInput } from '../../core/api/asset-captions-api.service';
import { PeopleApiService, PersonSummary } from '../../core/api/people-api.service';
import { describeError } from '../../core/describe-error';
import { ConfirmService } from '../../shared/confirm.service';

export interface CaptionChange {
  assetId: string;
  caption?: AssetCaption;
  deletedId?: string;
  captions?: AssetCaption[];
}

export function applyCaptionChange(entries: AssetCaption[], change: CaptionChange): AssetCaption[] {
  if (change.captions) return change.captions;
  const next = entries.filter((c) => c.id !== change.deletedId && c.id !== change.caption?.id);
  if (change.caption) next.push(change.caption);
  return next.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

@Component({
  selector: 'app-asset-captions',
  imports: [FormsModule, RouterLink],
  templateUrl: './asset-captions.html',
  styleUrl: './asset-captions.scss',
  host: { '(keydown.escape)': 'escape($event)' },
})
export class AssetCaptions {
  readonly assetId = input.required<string>();
  readonly captions = input<AssetCaption[]>([]);
  readonly canWrite = input(false);
  readonly changed = output<CaptionChange>();
  readonly entries = signal<AssetCaption[]>([]);
  readonly editing = signal(false);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly status = signal('');
  readonly peopleError = signal('');
  readonly peopleLoading = signal(false);
  readonly options = signal<PersonSummary[]>([]);
  text = '';
  attributed = false;
  query = '';
  selected: PersonSummary | null = null;
  private editingId: string | null = null;
  private preserveAttribution = false;
  private generation = 0;
  private lookupRequest = 0;
  private lastAssetId: string | null = null;
  private returnFocus: HTMLElement | null = null;
  private readonly api = inject(AssetCaptionsApiService);
  readonly people = inject(PeopleApiService);
  private readonly confirm = inject(ConfirmService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  constructor() {
    effect(() => {
      const id = this.assetId(),
        entries = this.captions();
      untracked(() => {
        if (id !== this.lastAssetId) {
          this.lastAssetId = id;
          this.generation++;
          this.lookupRequest++;
          this.editing.set(false);
          this.busy.set(false);
          this.error.set('');
          this.status.set('');
          this.text = '';
          this.options.set([]);
          this.peopleLoading.set(false);
          this.peopleError.set('');
        }
        this.entries.set(entries);
      });
    });
    inject(DestroyRef).onDestroy(() => {
      this.generation++;
      this.lookupRequest++;
    });
  }

  length(): number {
    return Array.from(this.text.trim()).length;
  }
  choices(): PersonSummary[] {
    const query = this.query.trim().toLocaleLowerCase();
    return this.options()
      .filter((p) => p.name?.toLocaleLowerCase().includes(query))
      .slice(0, 4);
  }

  start(entry?: AssetCaption): void {
    if (!this.canWrite() || this.busy() || (!entry && this.entries().length >= 10)) return;
    this.generation++;
    this.lookupRequest++;
    this.peopleLoading.set(false);
    this.peopleError.set('');
    this.returnFocus = document.activeElement as HTMLElement | null;
    this.editingId = entry?.id ?? null;
    this.text = entry?.text ?? '';
    this.attributed = entry?.saidByLabel != null;
    this.query = entry?.saidByLabel ?? '';
    this.selected = null;
    this.preserveAttribution = this.attributed;
    this.error.set('');
    this.status.set('');
    this.editing.set(true);
    this.focus('textarea');
    if (this.attributed) void this.loadPeople();
  }

  cancel(): void {
    if (this.busy()) return;
    this.generation++;
    this.lookupRequest++;
    this.peopleLoading.set(false);
    this.editing.set(false);
    this.error.set('');
    this.restoreFocus();
  }

  setAttribution(enabled: boolean): void {
    this.attributed = enabled;
    this.selected = null;
    this.preserveAttribution = false;
    this.query = '';
    if (enabled) {
      void this.loadPeople();
      this.focus('input[type="search"]');
    }
  }
  queryChanged(value: string): void {
    this.query = value;
    this.selected = null;
    this.preserveAttribution = false;
  }
  choose(person: PersonSummary): void {
    this.selected = person;
    this.query = person.name ?? '';
    this.preserveAttribution = false;
    this.focus('input[type="search"]');
  }

  async loadPeople(): Promise<void> {
    const generation = this.generation,
      assetId = this.assetId(),
      request = ++this.lookupRequest;
    this.peopleLoading.set(true);
    this.peopleError.set('');
    try {
      const { people } = await this.people.attributionOptions();
      if (this.isCurrent(assetId, generation) && request === this.lookupRequest)
        this.options.set(people);
    } catch (error) {
      if (this.isCurrent(assetId, generation) && request === this.lookupRequest)
        this.peopleError.set(
          describeError(error, 'Could not load people. You can still save a plain caption.'),
        );
    } finally {
      if (this.isCurrent(assetId, generation) && request === this.lookupRequest)
        this.peopleLoading.set(false);
    }
  }

  async save(): Promise<void> {
    if (!this.canWrite() || this.busy() || !this.editing()) return;
    if (!this.length() || this.length() > 500 || this.text.includes('\0')) {
      this.error.set('Enter 1–500 characters, without null characters.');
      return;
    }
    if (this.attributed && !this.selected && !this.preserveAttribution) {
      this.error.set('Select a person from the choices, or turn off Said by.');
      return;
    }
    const body: CaptionInput = { text: this.text.trim() };
    if (!this.attributed) body.saidByPersonId = null;
    else if (this.selected) body.saidByPersonId = this.selected.id;
    const assetId = this.assetId(),
      generation = this.generation,
      id = this.editingId;
    this.busy.set(true);
    this.error.set('');
    try {
      const { caption } = id
        ? await this.api.update(assetId, id, body)
        : await this.api.create(assetId, body);
      if (!this.isCurrent(assetId, generation)) return;
      this.apply({ assetId, caption });
      this.status.set('Caption saved.');
      this.editing.set(false);
      this.restoreFocus();
    } catch (error) {
      if (!this.isCurrent(assetId, generation)) return;
      const status = (error as { status?: number }).status;
      this.error.set(
        status === 404 && id
          ? 'This caption no longer exists. Cancel to reload, or copy your draft into a new caption.'
          : describeError(
              error,
              status === 409
                ? 'This photo already has ten captions.'
                : 'Could not save. Your draft is still here; please try again.',
            ),
      );
      if (status === 409 || status === 404) await this.refresh(assetId, generation);
    } finally {
      if (this.isCurrent(assetId, generation)) this.busy.set(false);
    }
  }

  async remove(entry: AssetCaption): Promise<void> {
    if (!this.canWrite() || this.busy()) return;
    const assetId = this.assetId(),
      generation = this.generation;
    this.returnFocus = document.activeElement as HTMLElement | null;
    this.busy.set(true);
    this.error.set('');
    try {
      const yes = await this.confirm.ask({
        title: 'Delete caption?',
        message: 'This permanently deletes this caption.',
        confirmLabel: 'Delete caption',
      });
      if (!yes || !this.isCurrent(assetId, generation)) return;
      await this.api.delete(assetId, entry.id);
      if (!this.isCurrent(assetId, generation)) return;
      this.apply({ assetId, deletedId: entry.id });
      this.status.set('Caption deleted.');
      if (this.editingId === entry.id) this.editing.set(false);
      this.focus('[data-add]');
    } catch (error) {
      if (this.isCurrent(assetId, generation))
        this.error.set(describeError(error, 'Could not delete the caption. Please try again.'));
    } finally {
      if (this.isCurrent(assetId, generation)) this.busy.set(false);
    }
  }

  escape(event: Event): void {
    if (!this.editing()) return;
    event.stopPropagation();
    event.preventDefault();
    this.cancel();
  }
  private apply(change: CaptionChange): void {
    this.entries.set(applyCaptionChange(this.entries(), change));
    this.changed.emit(change);
  }
  private async refresh(assetId: string, generation: number): Promise<void> {
    try {
      const { captions } = await this.api.list(assetId);
      if (this.isCurrent(assetId, generation)) this.apply({ assetId, captions });
    } catch {
      /* Preserve the saved list and draft if reconciliation also fails. */
    }
  }
  private isCurrent(assetId: string, generation: number): boolean {
    return assetId === this.assetId() && generation === this.generation;
  }
  private focus(selector: string): void {
    const generation = this.generation,
      assetId = this.assetId();
    setTimeout(() => {
      if (this.isCurrent(assetId, generation))
        this.host.nativeElement.querySelector<HTMLElement>(selector)?.focus();
    });
  }
  private restoreFocus(): void {
    const control = this.returnFocus,
      generation = this.generation,
      assetId = this.assetId();
    setTimeout(() => {
      if (this.isCurrent(assetId, generation)) {
        if (control?.isConnected) control.focus();
        else this.host.nativeElement.querySelector<HTMLElement>('[data-add]')?.focus();
      }
    });
  }
}
