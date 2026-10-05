import { Component, computed, inject, input, OnInit, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MemoriesApiService } from '../core/api/memories-api.service';
import { MemorySummary } from '../core/api/api-models';
import { Sheet } from './sheet';

/**
 * What the picker settled on. `alreadyAdded` is true when the memory was
 * created around these very photos, so the caller must not attach them a
 * second time.
 */
export interface MemoryPick {
  memoryId: string;
  alreadyAdded: boolean;
}

/**
 * Typeahead memory picker, the twin of <app-album-picker>: one box filters
 * existing memories as you type, and the same text names a new one when
 * nothing matches exactly. Chrome comes from the shared <app-sheet>.
 */
@Component({
  selector: 'app-memory-picker',
  imports: [FormsModule, Sheet],
  templateUrl: './memory-picker.html',
  styleUrl: './memory-picker.scss',
})
export class MemoryPicker implements OnInit {
  private readonly api = inject(MemoriesApiService);

  /**
   * The photos being filed. A memory takes its date span from its contents, so
   * a new one is created around them in a single call rather than being made
   * empty and filled afterwards.
   */
  readonly assetIds = input.required<readonly string[]>();

  readonly picked = output<MemoryPick>();
  readonly cancelled = output<void>();

  readonly memories = signal<MemorySummary[]>([]);
  readonly filterText = signal('');
  readonly isBusy = signal(false);

  readonly filtered = computed(() => {
    const needle = this.filterText().trim().toLowerCase();
    if (needle.length === 0) {
      return this.memories();
    }
    return this.memories().filter((memory) => memory.title.toLowerCase().includes(needle));
  });

  /** Offer creation only when the typed name isn't already a memory. */
  readonly canCreate = computed(() => {
    const name = this.filterText().trim();
    return (
      name.length > 0 &&
      !this.memories().some((memory) => memory.title.toLowerCase() === name.toLowerCase())
    );
  });

  ngOnInit(): void {
    void this.load();
  }

  coverUrl(memory: MemorySummary): string | null {
    return memory.coverAssetId ? `/api/v1/assets/${memory.coverAssetId}/thumb/240` : null;
  }

  /** "March 2025", or "March 2025 — April 2025" when it straddles months. */
  spanLabel(memory: MemorySummary): string {
    const format = (iso: string) =>
      new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(new Date(iso));
    const start = format(memory.startAt);
    const end = format(memory.endAt);
    return start === end ? start : `${start} — ${end}`;
  }

  choose(memoryId: string): void {
    this.picked.emit({ memoryId, alreadyAdded: false });
  }

  async createAndChoose(): Promise<void> {
    const title = this.filterText().trim();
    if (title.length === 0 || this.isBusy()) {
      return;
    }
    this.isBusy.set(true);
    try {
      const { memoryId } = await this.api.createMemory(title, [...this.assetIds()]);
      this.picked.emit({ memoryId, alreadyAdded: true });
    } finally {
      this.isBusy.set(false);
    }
  }

  private async load(): Promise<void> {
    const { memories } = await this.api.listMemories();
    this.memories.set(memories);
  }
}
