import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { DATABASE } from '../database/database.module';
import type { Database } from '../database/database.module';
import { assetCaption, face, person } from '../database/schema';
import { MlProcessingService } from './ml-processing.service';

/** A person row in the People view. */
export interface PersonSummary {
  id: string;
  name: string | null;
  faceCount: number;
  /** The best-quality face, for a cropped avatar. */
  coverFaceId: string | null;
  /** Marked as close family — surfaced first on the home page. */
  favorite: boolean;
}

/** One face instance of a person (for merge/split/ignore curation). */
export interface PersonFace {
  id: string;
  assetId: string;
  quality: number;
}

/** Everyone detected in the library, most-photographed first. */
@Injectable()
export class PeopleService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly mlProcessing: MlProcessingService,
  ) {}

  async list(): Promise<PersonSummary[]> {
    const result = await this.db.execute(sql`
      SELECT p.id, p.name, p.favorite,
             count(f.id) AS face_count,
             coalesce(
               -- The admin-chosen avatar wins, as long as it still belongs.
               (SELECT f3.id FROM face f3
                WHERE f3.id = p.cover_face_id AND f3.person_id = p.id AND f3.ignored = false),
               (SELECT f2.id FROM face f2
                WHERE f2.person_id = p.id AND f2.ignored = false
                ORDER BY f2.quality DESC LIMIT 1)
             ) AS cover_face_id
      FROM person p
      JOIN face f ON f.person_id = p.id AND f.ignored = false
      WHERE p.merged_into_id IS NULL AND p.hidden = false
      GROUP BY p.id, p.name, p.favorite
      -- Favorites first, then most-photographed.
      ORDER BY p.favorite DESC, count(f.id) DESC
    `);
    return result.rows.map((row) => ({
      id: row.id as string,
      name: (row.name as string | null) ?? null,
      faceCount: Number(row.face_count),
      coverFaceId: (row.cover_face_id as string | null) ?? null,
      favorite: Boolean(row.favorite),
    }));
  }

  async attributionOptions(): Promise<PersonSummary[]> {
    const result = await this.db.execute(sql`
      select p.id, p.name, p.favorite,
        (select count(*)::int from face f where f.person_id = p.id and f.ignored = false) as face_count,
        coalesce(
          (select f.id from face f where f.id = p.cover_face_id and f.person_id = p.id and f.ignored = false),
          (select f.id from face f where f.person_id = p.id and f.ignored = false order by f.quality desc, f.id limit 1)
        ) as cover_face_id
      from person p where p.hidden = false and p.merged_into_id is null and length(btrim(p.name)) > 0
      order by lower(p.name), p.id
    `);
    return result.rows.map((r) => ({ id: r.id as string, name: r.name as string,
      favorite: Boolean(r.favorite), faceCount: Number(r.face_count), coverFaceId: r.cover_face_id as string | null }));
  }

  /** Mark (or unmark) a person as close family — drives home-page ranking. */
  async setFavorite(personId: string, favorite: boolean): Promise<void> {
    await this.requirePerson(personId);
    await this.db
      .update(person)
      .set({ favorite, updatedAt: new Date() })
      .where(sql`${person.id} = ${personId}`);
  }

  /** Every visible face of a person, best quality first (curation UI). */
  async getFaces(personId: string): Promise<PersonFace[]> {
    await this.requirePerson(personId);
    const rows = await this.db
      .select({ id: face.id, assetId: face.assetId, quality: face.quality })
      .from(face)
      .where(sql`${face.personId} = ${personId} and ${face.ignored} = false`)
      .orderBy(sql`${face.quality} desc`);
    return rows;
  }

  /**
   * Merges this person into another: every face repoints to the target and the
   * source becomes a tombstone. A name survives — if the target is unnamed and
   * the source was named, the target takes the name.
   */
  async mergeInto(sourceId: string, targetId: string): Promise<void> {
    if (sourceId === targetId) {
      throw new BadRequestException('A person cannot be merged into themselves.');
    }
    await this.db.transaction(async (tx) => {
      const locked = await tx.select().from(person).where(inArray(person.id, [sourceId, targetId])).orderBy(person.id).for('update');
      const source = locked.find((p) => p.id === sourceId);
      const target = locked.find((p) => p.id === targetId);
      if (!source || !target || source.mergedIntoId || target.mergedIntoId) {
        throw new NotFoundException('That person does not exist.');
      }
      const effectiveName = target.name?.trim() || source.name?.trim() || null;
      await tx.update(assetCaption).set({
        saidByPersonId: targetId,
        ...(effectiveName ? { saidByLabel: effectiveName } : {}),
      }).where(eq(assetCaption.saidByPersonId, sourceId));
      if (effectiveName) {
        await tx.update(assetCaption).set({ saidByLabel: effectiveName }).where(eq(assetCaption.saidByPersonId, targetId));
      }
      await tx.update(face).set({ personId: targetId }).where(eq(face.personId, sourceId));
      await tx
        .update(person)
        .set({ mergedIntoId: targetId, updatedAt: new Date() })
        .where(eq(person.id, sourceId));
      if (!target.name?.trim() && source.name?.trim()) {
        await tx
          .update(person)
          .set({ name: source.name, updatedAt: new Date() })
          .where(eq(person.id, targetId));
      }
    });
  }

  /**
   * "Not the same person": moves the given faces out into a new person.
   * Moved faces become user assignments so re-clustering never undoes it.
   */
  async split(personId: string, faceIds: string[]): Promise<{ personId: string }> {
    await this.requirePerson(personId);
    const owned = await this.db
      .select({ id: face.id })
      .from(face)
      .where(and(eq(face.personId, personId), inArray(face.id, faceIds)));
    if (owned.length !== faceIds.length) {
      throw new BadRequestException('Some of those faces do not belong to this person.');
    }
    const newPersonId = uuidv7();
    await this.db.transaction(async (tx) => {
      await tx.insert(person).values({ id: newPersonId });
      await tx
        .update(face)
        .set({ personId: newPersonId, assignment: 'user' })
        .where(inArray(face.id, faceIds));
    });
    return { personId: newPersonId };
  }

  /** Ignored faces vanish from people, counts, and future clustering. */
  async ignoreFaces(faceIds: string[]): Promise<void> {
    await this.db.update(face).set({ ignored: true }).where(inArray(face.id, faceIds));
  }

  /**
   * "This cluster is simply wrong": detaches every auto-assigned face and
   * re-clusters each against the rest of the library from scratch — similar
   * faces regroup (possibly into several correct people), the hopeless ones
   * become their own clusters. User-pinned faces stay put; if none remain,
   * the person row is deleted.
   */
  async disband(personId: string): Promise<{ reclustered: number }> {
    await this.requirePerson(personId);
    // Detach first so re-clustering can't match a face against its old pals.
    const detached = await this.db
      .update(face)
      .set({ personId: null })
      .where(and(eq(face.personId, personId), eq(face.assignment, 'auto'), eq(face.ignored, false)))
      .returning({ id: face.id });
    const detachedIds = detached.map((row) => row.id);
    for (const faceId of detachedIds) {
      const [row] = await this.db.execute<{ embedding: string }>(
        sql`select embedding::text as embedding from face where id = ${faceId}`,
      ).then((result) => result.rows);
      if (!row) {
        continue;
      }
      const newPersonId = await this.mlProcessing.clusterIntoPerson(
        JSON.parse(row.embedding) as number[],
      );
      await this.db.update(face).set({ personId: newPersonId }).where(eq(face.id, faceId));
    }
    // No pinned faces left behind → the identity itself was a mistake; drop it.
    const [remaining] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(face)
      .where(eq(face.personId, personId));
    if (remaining.count === 0) {
      await this.db.delete(person).where(eq(person.id, personId));
    }
    return { reclustered: detachedIds.length };
  }

  /** Hides a person from the People view entirely (e.g. strangers in backgrounds). */
  async hide(personId: string): Promise<void> {
    await this.requirePerson(personId);
    await this.db
      .update(person)
      .set({ hidden: true, updatedAt: new Date() })
      .where(eq(person.id, personId));
  }

  /** All photos this person appears in, newest first. */
  async getAssets(personId: string): Promise<string[]> {
    await this.requirePerson(personId);
    const result = await this.db.execute(sql`
      SELECT DISTINCT f.asset_id, a.captured_at
      FROM face f
      JOIN asset a ON a.id = f.asset_id AND a.status = 'active'
      WHERE f.person_id = ${personId} AND f.ignored = false
      ORDER BY a.captured_at DESC
    `);
    return result.rows.map((row) => row.asset_id as string);
  }

  /**
   * "Remove from this person": the faces go back into the pool and re-cluster
   * — excluding this person, so they land on the next-best match or start a
   * fresh unnamed cluster instead of bouncing straight back.
   */
  async removeFaces(personId: string, faceIds: string[]): Promise<{ removed: number }> {
    await this.requirePerson(personId);
    const detached = await this.db
      .update(face)
      .set({ personId: null })
      .where(and(inArray(face.id, faceIds), eq(face.personId, personId), eq(face.ignored, false)))
      .returning({ id: face.id });
    for (const row of detached) {
      const [withEmbedding] = await this.db
        .execute<{ embedding: string }>(
          sql`select embedding::text as embedding from face where id = ${row.id}`,
        )
        .then((result) => result.rows);
      if (!withEmbedding) {
        continue;
      }
      const newPersonId = await this.mlProcessing.clusterIntoPerson(
        JSON.parse(withEmbedding.embedding) as number[],
        personId,
      );
      await this.db.update(face).set({ personId: newPersonId }).where(eq(face.id, row.id));
    }
    // Removing the last face means the identity itself was a mistake; drop it.
    const [remaining] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(face)
      .where(eq(face.personId, personId));
    if (remaining.count === 0) {
      await this.db.delete(person).where(eq(person.id, personId));
    }
    return { removed: detached.length };
  }

  /** Pins one of the person's own faces as their avatar everywhere. */
  async setCoverFace(personId: string, faceId: string): Promise<void> {
    await this.requirePerson(personId);
    const [row] = await this.db
      .select({ id: face.id })
      .from(face)
      .where(sql`${face.id} = ${faceId} and ${face.personId} = ${personId} and ${face.ignored} = false`)
      .limit(1);
    if (!row) {
      throw new NotFoundException("That face doesn't belong to this person.");
    }
    await this.db
      .update(person)
      .set({ coverFaceId: faceId, updatedAt: new Date() })
      .where(eq(person.id, personId));
  }

  /** Naming a cluster turns it into a known person (data-model.md §1.3). */
  async rename(personId: string, name: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [row] = await tx.select().from(person).where(eq(person.id, personId)).for('update');
      if (!row || row.mergedIntoId) throw new NotFoundException('That person does not exist.');
      const label = name.trim() || null;
      await tx.update(person).set({ name: label, updatedAt: new Date() }).where(eq(person.id, personId));
      if (label) await tx.update(assetCaption).set({ saidByLabel: label }).where(eq(assetCaption.saidByPersonId, personId));
    });
  }

  private async requirePerson(personId: string): Promise<typeof person.$inferSelect> {
    const [row] = await this.db
      .select()
      .from(person)
      .where(eq(person.id, personId))
      .limit(1);
    if (!row || row.mergedIntoId !== null) {
      throw new NotFoundException('That person does not exist.');
    }
    return row;
  }
}
