import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { DATABASE } from '../database/database.module';
import type { Database } from '../database/database.module';
import { person } from '../database/schema';

/** A person row in the People view. */
export interface PersonSummary {
  id: string;
  name: string | null;
  faceCount: number;
  /** An asset to use as the avatar (best-quality face's photo). */
  coverAssetId: string | null;
}

/** Everyone detected in the library, most-photographed first. */
@Injectable()
export class PeopleService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async list(): Promise<PersonSummary[]> {
    const result = await this.db.execute(sql`
      SELECT p.id, p.name,
             count(f.id) AS face_count,
             (SELECT f2.asset_id FROM face f2
              WHERE f2.person_id = p.id AND f2.ignored = false
              ORDER BY f2.quality DESC LIMIT 1) AS cover_asset_id
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
      coverAssetId: (row.cover_asset_id as string | null) ?? null,
    }));
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

  private async requirePerson(personId: string): Promise<void> {
    const [row] = await this.db
      .select({ id: person.id })
      .from(person)
      .where(eq(person.id, personId))
      .limit(1);
    if (!row) {
      throw new NotFoundException('That person does not exist.');
    }
  }
}
