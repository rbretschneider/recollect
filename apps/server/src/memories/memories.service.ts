import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { DATABASE } from '../database/database.module';
import type { Database } from '../database/database.module';
import {
  asset,
  journalEntry,
  memory,
  memoryAsset,
  memoryQuote,
  person,
  userAccount,
} from '../database/schema';

/** A Memory card on the timeline. */
export interface MemorySummary {
  id: string;
  title: string;
  startAt: string;
  endAt: string;
  coverAssetId: string | null;
  assetCount: number;
  journalPreview: string | null;
  locationLabel: string | null;
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
  /** Scrapbook captions keyed by asset id (only captioned photos appear). */
  captions: Record<string, string>;
  journal: JournalEntryView[];
  quotes: MemoryQuoteView[];
  /** Named people recognized in this memory's photos, most-seen first. */
  people: MemoryPersonView[];
  /** Face clusters present but not yet named. */
  unnamedPeopleCount: number;
  /** Median GPS of the member photos, for the map view; null when none have GPS. */
  gpsLat: number | null;
  gpsLon: number | null;
}

/** Someone recognized in a memory's photos; name null = not yet named. */
export interface MemoryPersonView {
  id: string;
  name: string | null;
  /** Best face OF THIS MEMORY for the avatar — always present. */
  coverFaceId: string;
  /** In how many of this memory's photos they appear. */
  photoCount: number;
  /** True when they're here only as the photographer (device mapping). */
  behindCamera: boolean;
}

/** A "quote of the day": what was said and who said it. */
export interface MemoryQuoteView {
  id: string;
  text: string;
  saidBy: string;
  /** Linked Person (face cluster), so the attribution can jump to their photos. */
  saidByPersonId: string | null;
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
    // One statement with lateral aggregates — the old shape was 2 queries per
    // memory, which multiplied badly over a slow home-server link.
    const result = await this.db.execute<{
      id: string;
      title: string;
      start_at: Date;
      end_at: Date;
      location_label: string | null;
      cover_asset_id: string | null;
      asset_count: number;
      journal_preview: string | null;
    }>(sql`
      select m.id, m.title, m.start_at, m.end_at, m.location_label,
             coalesce(m.cover_asset_id, mm.first_asset) as cover_asset_id,
             coalesce(mm.asset_count, 0)::int as asset_count,
             j.journal_preview
      from memory m
      left join lateral (
        select count(*) as asset_count,
               (array_agg(ma.asset_id order by ma.sort_order))[1] as first_asset
        from memory_asset ma where ma.memory_id = m.id
      ) mm on true
      left join lateral (
        select left(je.body_md, ${JOURNAL_PREVIEW_LENGTH}) as journal_preview
        from journal_entry je where je.memory_id = m.id
        order by je.created_at limit 1
      ) j on true
      where m.deleted_at is null
      order by m.start_at desc
    `);
    return result.rows.map((row) => ({
      id: row.id,
      title: row.title,
      startAt: new Date(row.start_at).toISOString(),
      endAt: new Date(row.end_at).toISOString(),
      coverAssetId: row.cover_asset_id,
      assetCount: row.asset_count,
      journalPreview: row.journal_preview,
      locationLabel: row.location_label,
    }));
  }

  async getDetail(memoryId: string): Promise<MemoryDetail> {
    const row = await this.requireMemory(memoryId);
    const assetIds = await this.loadAssetIds(memoryId);
    const captions = await this.loadCaptions(memoryId);
    const journal = await this.loadJournal(memoryId);
    const quotes = await this.loadQuotes(memoryId);
    const { people, unnamedPeopleCount } = await this.loadPeople(memoryId);
    const location = await this.loadMedianGps(memoryId);
    return {
      gpsLat: location?.lat ?? null,
      gpsLon: location?.lon ?? null,
      id: row.id,
      title: row.title,
      description: row.description,
      startAt: row.startAt.toISOString(),
      endAt: row.endAt.toISOString(),
      datePrecision: row.datePrecision,
      locationLabel: row.locationLabel,
      coverAssetId: row.coverAssetId ?? assetIds[0] ?? null,
      assetIds,
      captions,
      journal,
      quotes,
      people,
      unnamedPeopleCount,
    };
  }

  /**
   * Who was there: face-recognized people across the memory's photos, named
   * first. The avatar is the best-quality face FROM THIS MEMORY, so every
   * chip has one — including "who's this?" clusters awaiting a name.
   */
  private async loadPeople(
    memoryId: string,
  ): Promise<{ people: MemoryPersonView[]; unnamedPeopleCount: number }> {
    const result = await this.db.execute<{
      id: string;
      name: string | null;
      cover_face_id: string;
      photo_count: number;
    }>(sql`
      select coalesce(survivor.id, p.id) as id,
             coalesce(survivor.name, p.name) as name,
             (array_agg(f.id order by f.quality desc))[1] as cover_face_id,
             count(distinct f.asset_id)::int as photo_count
      from memory_asset ma
      join face f on f.asset_id = ma.asset_id and f.ignored = false
      join person p on p.id = f.person_id
      left join person survivor on survivor.id = p.merged_into_id
      where ma.memory_id = ${memoryId}
        and coalesce(survivor.hidden, p.hidden) = false
      group by 1, 2
      order by (coalesce(survivor.name, p.name) is null), count(distinct f.asset_id) desc
    `);
    const people: MemoryPersonView[] = result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      coverFaceId: row.cover_face_id,
      photoCount: row.photo_count,
      behindCamera: false,
    }));
    // The photographer is never IN the photos: add camera owners whose device
    // shot photos in this memory but whose face never appears.
    const photographers = await this.db.execute<{
      id: string;
      name: string | null;
      cover_face_id: string | null;
      photo_count: number;
    }>(sql`
      with owners as (
        select coalesce(survivor.id, p.id) as id,
               coalesce(survivor.name, p.name) as name,
               count(distinct ma.asset_id)::int as photo_count
        from memory_asset ma
        join asset a on a.id = ma.asset_id
        join device_owner d
          on d.camera_make = coalesce(a.camera_make, '')
         and d.camera_model = coalesce(a.camera_model, '')
        join person p on p.id = d.person_id
        left join person survivor on survivor.id = p.merged_into_id
        where ma.memory_id = ${memoryId}
          and coalesce(survivor.hidden, p.hidden) = false
        group by 1, 2
      )
      select o.id, o.name, o.photo_count,
             (select f.id from face f
              where f.person_id = o.id and f.ignored = false
              order by f.quality desc limit 1) as cover_face_id
      from owners o
    `);
    const seen = new Set(people.map((entry) => entry.id));
    for (const row of photographers.rows) {
      if (!seen.has(row.id) && row.cover_face_id !== null) {
        people.push({
          id: row.id,
          name: row.name,
          coverFaceId: row.cover_face_id,
          photoCount: row.photo_count,
          behindCamera: true,
        });
      }
    }
    return {
      people,
      unnamedPeopleCount: people.filter((entry) => entry.name === null).length,
    };
  }

  /** Adds a "quote of the day"; as many as the day deserves. */
  async addQuote(
    memoryId: string,
    userId: string,
    quoteText: string,
    saidBy: string,
    saidByPersonId?: string,
  ): Promise<MemoryQuoteView> {
    await this.requireMemory(memoryId);
    const personId = saidByPersonId ?? (await this.matchPersonByName(saidBy));
    const id = uuidv7();
    await this.db.insert(memoryQuote).values({
      id,
      memoryId,
      text: quoteText.trim(),
      saidBy: saidBy.trim(),
      saidByPersonId: personId,
      createdBy: userId,
    });
    return { id, text: quoteText.trim(), saidBy: saidBy.trim(), saidByPersonId: personId };
  }

  /**
   * Auto-link: a typed name that unambiguously matches ONE named Person
   * becomes a link without any extra taps. "Emma, 4" matches person "Emma"
   * via the first comma segment; two Emmas match nobody.
   */
  private async matchPersonByName(saidBy: string): Promise<string | null> {
    const name = saidBy.split(',')[0]?.trim();
    if (!name) {
      return null;
    }
    const matches = await this.db
      .select({ id: person.id })
      .from(person)
      .where(
        sql`lower(${person.name}) = lower(${name})
            and ${person.mergedIntoId} is null and ${person.hidden} = false`,
      )
      .limit(2);
    return matches.length === 1 ? matches[0].id : null;
  }

  async deleteQuote(memoryId: string, quoteId: string): Promise<void> {
    await this.db
      .delete(memoryQuote)
      .where(and(eq(memoryQuote.id, quoteId), eq(memoryQuote.memoryId, memoryId)));
  }

  private async loadQuotes(memoryId: string): Promise<MemoryQuoteView[]> {
    const rows = await this.db
      .select({
        id: memoryQuote.id,
        text: memoryQuote.text,
        saidBy: memoryQuote.saidBy,
        // Follow a merge so the link lands on the surviving person.
        saidByPersonId: sql<string | null>`coalesce(${person.mergedIntoId}, ${person.id})`,
      })
      .from(memoryQuote)
      .leftJoin(person, eq(person.id, memoryQuote.saidByPersonId))
      .where(eq(memoryQuote.memoryId, memoryId))
      .orderBy(asc(memoryQuote.createdAt));
    return rows;
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

  /** Median GPS of member photos — robust against one mis-tagged outlier. */
  private async loadMedianGps(memoryId: string): Promise<{ lat: number; lon: number } | null> {
    const [row] = await this.db
      .select({
        lat: sql<number | null>`percentile_cont(0.5) within group (order by ${asset.gpsLat})`,
        lon: sql<number | null>`percentile_cont(0.5) within group (order by ${asset.gpsLon})`,
      })
      .from(memoryAsset)
      .innerJoin(asset, eq(asset.id, memoryAsset.assetId))
      .where(and(eq(memoryAsset.memoryId, memoryId), sql`${asset.gpsLat} is not null`));
    if (!row || row.lat === null || row.lon === null) {
      return null;
    }
    return { lat: Number(row.lat), lon: Number(row.lon) };
  }

  private async loadAssetIds(memoryId: string): Promise<string[]> {
    const rows = await this.db
      .select({ assetId: memoryAsset.assetId })
      .from(memoryAsset)
      .where(eq(memoryAsset.memoryId, memoryId))
      .orderBy(asc(memoryAsset.sortOrder));
    return rows.map((row) => row.assetId);
  }

  private async loadCaptions(memoryId: string): Promise<Record<string, string>> {
    const rows = await this.db
      .select({ assetId: memoryAsset.assetId, caption: memoryAsset.caption })
      .from(memoryAsset)
      .where(eq(memoryAsset.memoryId, memoryId));
    const captions: Record<string, string> = {};
    for (const row of rows) {
      if (row.caption !== null && row.caption.trim().length > 0) {
        captions[row.assetId] = row.caption;
      }
    }
    return captions;
  }

  /** Writes (or clears, with empty text) one photo's scrapbook caption. */
  async setCaption(memoryId: string, assetId: string, caption: string): Promise<void> {
    await this.requireMemory(memoryId);
    const trimmed = caption.trim();
    await this.db
      .update(memoryAsset)
      .set({ caption: trimmed.length > 0 ? trimmed : null })
      .where(and(eq(memoryAsset.memoryId, memoryId), eq(memoryAsset.assetId, assetId)));
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
