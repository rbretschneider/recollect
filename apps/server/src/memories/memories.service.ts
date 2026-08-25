import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { DATABASE } from '../database/database.module';
import type { Database } from '../database/database.module';
import { asset, journalEntry, memory, memoryAsset, userAccount } from '../database/schema';

/** A Memory card on the timeline. */
export interface MemorySummary {
  id: string;
  title: string;
  startAt: string;
  endAt: string;
  coverAssetId: string | null;
  assetCount: number;
  journalPreview: string | null;
}

/** Full Memory detail. */
export interface MemoryDetail {
  id: string;
  title: string;
  description: string | null;
  startAt: string;
  endAt: string;
  datePrecision: string;
  locationLabel: string | null;
  coverAssetId: string | null;
  assetIds: string[];
  journal: JournalEntryView[];
}

/** A journal entry with attribution. */
export interface JournalEntryView {
  id: string;
  authorName: string;
  authorUserId: string;
  bodyMd: string;
  updatedAt: string;
}

/** Editable Memory fields (all optional; only provided fields change). */
export interface MemoryEdits {
  title?: string;
  description?: string | null;
  startAt?: Date;
  endAt?: Date;
  datePrecision?: string;
  locationLabel?: string | null;
  coverAssetId?: string | null;
}

const JOURNAL_PREVIEW_LENGTH = 140;

/** Human-owned Memory CRUD and journal writing. Machine code never calls this. */
@Injectable()
export class MemoriesService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async list(): Promise<MemorySummary[]> {
    const rows = await this.db
      .select()
      .from(memory)
      .where(isNull(memory.deletedAt))
      .orderBy(desc(memory.startAt));
    const summaries: MemorySummary[] = [];
    for (const row of rows) {
      const assetIds = await this.loadAssetIds(row.id);
      const preview = await this.loadJournalPreview(row.id);
      summaries.push({
        id: row.id,
        title: row.title,
        startAt: row.startAt.toISOString(),
        endAt: row.endAt.toISOString(),
        coverAssetId: row.coverAssetId ?? assetIds[0] ?? null,
        assetCount: assetIds.length,
        journalPreview: preview,
      });
    }
    return summaries;
  }

  async getDetail(memoryId: string): Promise<MemoryDetail> {
    const row = await this.requireMemory(memoryId);
    const assetIds = await this.loadAssetIds(memoryId);
    const journal = await this.loadJournal(memoryId);
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      startAt: row.startAt.toISOString(),
      endAt: row.endAt.toISOString(),
      datePrecision: row.datePrecision,
      locationLabel: row.locationLabel,
      coverAssetId: row.coverAssetId ?? assetIds[0] ?? null,
      assetIds,
      journal,
    };
  }

  /** Manual Memory creation from a selection (or empty, S9.5). */
  async create(userId: string, title: string, assetIds: string[]): Promise<{ memoryId: string }> {
    const span = await this.resolveSpan(assetIds);
    const memoryId = uuidv7();
    await this.db.transaction(async (tx) => {
      await tx.insert(memory).values({
        id: memoryId,
        title,
        startAt: span.startAt,
        endAt: span.endAt,
        coverAssetId: assetIds[0] ?? null,
        createdBy: userId,
      });
      if (assetIds.length > 0) {
        await tx.insert(memoryAsset).values(
          assetIds.map((assetId, index) => ({ memoryId, assetId, sortOrder: index, addedBy: userId })),
        );
      }
    });
    return { memoryId };
  }

  async update(memoryId: string, edits: MemoryEdits): Promise<void> {
    await this.requireMemory(memoryId);
    await this.db
      .update(memory)
      .set({ ...edits, updatedAt: new Date() })
      .where(eq(memory.id, memoryId));
  }

  /** Soft delete (S9.7). Assets and journal entries are untouched and recoverable. */
  async softDelete(memoryId: string, userId: string): Promise<void> {
    await this.requireMemory(memoryId);
    await this.db
      .update(memory)
      .set({ deletedAt: new Date(), deletedBy: userId })
      .where(eq(memory.id, memoryId));
  }

  async addAssets(memoryId: string, assetIds: string[], userId: string): Promise<void> {
    await this.requireMemory(memoryId);
    if (assetIds.length === 0) {
      return;
    }
    const existing = await this.loadAssetIds(memoryId);
    const nextOrder = existing.length;
    const fresh = assetIds.filter((id) => !existing.includes(id));
    if (fresh.length === 0) {
      return;
    }
    await this.db.insert(memoryAsset).values(
      fresh.map((assetId, index) => ({
        memoryId,
        assetId,
        sortOrder: nextOrder + index,
        addedBy: userId,
      })),
    );
  }

  /** Removing media from a Memory never touches files (data-model.md §5.6). */
  async removeAsset(memoryId: string, assetId: string): Promise<void> {
    await this.requireMemory(memoryId);
    await this.db
      .delete(memoryAsset)
      .where(and(eq(memoryAsset.memoryId, memoryId), eq(memoryAsset.assetId, assetId)));
  }

  /** Upserts the calling user's own journal entry on a Memory (S9.6). */
  async writeJournal(memoryId: string, userId: string, bodyMd: string): Promise<void> {
    await this.requireMemory(memoryId);
    const [existing] = await this.db
      .select({ id: journalEntry.id })
      .from(journalEntry)
      .where(and(eq(journalEntry.memoryId, memoryId), eq(journalEntry.authorUserId, userId)))
      .limit(1);
    if (existing) {
      await this.db
        .update(journalEntry)
        .set({ bodyMd, updatedAt: new Date() })
        .where(eq(journalEntry.id, existing.id));
      return;
    }
    await this.db.insert(journalEntry).values({
      id: uuidv7(),
      memoryId,
      authorUserId: userId,
      bodyMd,
    });
  }

  private async requireMemory(memoryId: string): Promise<typeof memory.$inferSelect> {
    const [row] = await this.db
      .select()
      .from(memory)
      .where(and(eq(memory.id, memoryId), isNull(memory.deletedAt)))
      .limit(1);
    if (!row) {
      throw new NotFoundException('That memory does not exist.');
    }
    return row;
  }

  private async loadAssetIds(memoryId: string): Promise<string[]> {
    const rows = await this.db
      .select({ assetId: memoryAsset.assetId })
      .from(memoryAsset)
      .where(eq(memoryAsset.memoryId, memoryId))
      .orderBy(asc(memoryAsset.sortOrder));
    return rows.map((row) => row.assetId);
  }

  private async loadJournal(memoryId: string): Promise<JournalEntryView[]> {
    const rows = await this.db
      .select({
        id: journalEntry.id,
        authorUserId: journalEntry.authorUserId,
        authorName: userAccount.displayName,
        bodyMd: journalEntry.bodyMd,
        updatedAt: journalEntry.updatedAt,
      })
      .from(journalEntry)
      .innerJoin(userAccount, eq(userAccount.id, journalEntry.authorUserId))
      .where(eq(journalEntry.memoryId, memoryId))
      .orderBy(asc(journalEntry.createdAt));
    return rows.map((row) => ({
      id: row.id,
      authorUserId: row.authorUserId,
      authorName: row.authorName,
      bodyMd: row.bodyMd,
      updatedAt: row.updatedAt.toISOString(),
    }));
  }

  private async loadJournalPreview(memoryId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ bodyMd: journalEntry.bodyMd })
      .from(journalEntry)
      .where(eq(journalEntry.memoryId, memoryId))
      .orderBy(asc(journalEntry.createdAt))
      .limit(1);
    if (!row) {
      return null;
    }
    return row.bodyMd.length > JOURNAL_PREVIEW_LENGTH
      ? `${row.bodyMd.slice(0, JOURNAL_PREVIEW_LENGTH)}…`
      : row.bodyMd;
  }

  private async resolveSpan(assetIds: string[]): Promise<{ startAt: Date; endAt: Date }> {
    if (assetIds.length === 0) {
      const now = new Date();
      return { startAt: now, endAt: now };
    }
    const rows = await this.db
      .select({ capturedAt: asset.capturedAt })
      .from(asset)
      .where(inArray(asset.id, [...assetIds]));
    const times = rows.map((row) => row.capturedAt.getTime());
    if (times.length === 0) {
      const now = new Date();
      return { startAt: now, endAt: now };
    }
    return { startAt: new Date(Math.min(...times)), endAt: new Date(Math.max(...times)) };
  }
}
