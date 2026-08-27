import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { DATABASE } from '../database/database.module';
import type { Database } from '../database/database.module';
import { face, person } from '../database/schema';
import { MlProcessingService } from './ml-processing.service';

/** A person row in the People view. */
export interface PersonSummary {
  id: string;
  name: string | null;
  faceCount: number;
  /** The best-quality face, for a cropped avatar. */
  coverFaceId: string | null;
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
      SELECT p.id, p.name,
             count(f.id) AS face_count,
             (SELECT f2.id FROM face f2
              WHERE f2.person_id = p.id AND f2.ignored = false
              ORDER BY f2.quality DESC LIMIT 1) AS cover_face_id
      FROM person p
      JOIN face f ON f.person_id = p.id AND f.ignored = false
      WHERE p.merged_into_id IS NULL AND p.hidden = false
      GROUP BY p.id, p.name
      ORDER BY count(f.id) DESC
    `);
    return result.rows.map((row) => ({
      id: row.id as string,
      name: (row.name as string | null) ?? null,
      faceCount: Number(row.face_count),
      coverFaceId: (row.cover_face_id as string | null) ?? null,
    }));
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
    const source = await this.requirePerson(sourceId);
    const target = await this.requirePerson(targetId);
    await this.db.transaction(async (tx) => {
      await tx.update(face).set({ personId: targetId }).where(eq(face.personId, sourceId));
      await tx
        .update(person)
        .set({ mergedIntoId: targetId, updatedAt: new Date() })
        .where(eq(person.id, sourceId));
      if (target.name === null && source.name !== null) {
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

  /** Naming a cluster turns it into a known person (data-model.md §1.3). */
  async rename(personId: string, name: string): Promise<void> {
    await this.requirePerson(personId);
    await this.db
      .update(person)
      .set({ name: name.trim() || null, updatedAt: new Date() })
      .where(eq(person.id, personId));
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
