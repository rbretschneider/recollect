import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, count, eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { DATABASE, type Database } from '../database/database.module';
import { asset, assetCaption, person } from '../database/schema';

export interface AssetCaption {
  id: string;
  text: string;
  saidByPersonId: string | null;
  saidByLabel: string | null;
  createdAt: string;
  updatedAt: string;
}

export function normalizeCaptionText(value: unknown): string {
  if (typeof value !== 'string') throw new BadRequestException('Caption text is required.');
  const text = value.trim();
  if (!text || Array.from(text).length > 500 || text.includes('\0')) {
    throw new BadRequestException('Caption must contain 1–500 characters and no null characters.');
  }
  return text;
}

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

@Injectable()
export class AssetCaptionsService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async list(assetId: string): Promise<AssetCaption[]> {
    const [target] = await this.db.select({ mediaType: asset.mediaType }).from(asset).where(eq(asset.id, assetId));
    if (!target) throw new NotFoundException('That photo does not exist.');
    if (target.mediaType !== 'image') throw new BadRequestException('Captions are available for photos only.');
    return this.project(this.db, assetId);
  }

  async create(assetId: string, body: { text: string; saidByPersonId?: string | null }): Promise<AssetCaption> {
    const text = normalizeCaptionText(body.text);
    return this.db.transaction(async (tx) => {
      const attribution = await this.selection(tx, body.saidByPersonId ?? null);
      await this.lockAsset(tx, assetId);
      const [size] = await tx.select({ count: count() }).from(assetCaption).where(eq(assetCaption.assetId, assetId));
      if (size.count >= 10) throw new ConflictException({ code: 'CAPTION_LIMIT_REACHED', message: 'This photo already has ten captions.' });
      const id = uuidv7();
      await tx.insert(assetCaption).values({ id, assetId, text, ...attribution });
      return (await this.project(tx, assetId)).find((entry) => entry.id === id)!;
    });
  }

  async update(assetId: string, id: string, body: { text: string; saidByPersonId?: string | null }): Promise<AssetCaption> {
    const text = normalizeCaptionText(body.text);
    return this.db.transaction(async (tx) => {
      const attribution = body.saidByPersonId === undefined ? {} : await this.selection(tx, body.saidByPersonId);
      await this.lockAsset(tx, assetId);
      const rows = await tx.update(assetCaption).set({ text, ...attribution, updatedAt: new Date() })
        .where(and(eq(assetCaption.assetId, assetId), eq(assetCaption.id, id))).returning({ id: assetCaption.id });
      if (!rows.length) throw new NotFoundException('That caption no longer exists on this photo.');
      return (await this.project(tx, assetId)).find((entry) => entry.id === id)!;
    });
  }

  async delete(assetId: string, id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await this.lockAsset(tx, assetId);
      const rows = await tx.delete(assetCaption).where(and(eq(assetCaption.assetId, assetId), eq(assetCaption.id, id)))
        .returning({ id: assetCaption.id });
      if (!rows.length) throw new NotFoundException('That caption no longer exists on this photo.');
    });
  }

  private async lockAsset(tx: Transaction, id: string): Promise<void> {
    const [target] = await tx.select({ mediaType: asset.mediaType }).from(asset).where(eq(asset.id, id)).for('update');
    if (!target) throw new NotFoundException('That photo does not exist.');
    if (target.mediaType !== 'image') throw new BadRequestException('Captions are available for photos only.');
  }

  private async selection(tx: Transaction, id: string | null) {
    if (id === null) return { saidByPersonId: null, saidByLabel: null };
    // Person locks precede asset locks, matching person lifecycle transactions.
    const [speaker] = await tx.select().from(person).where(eq(person.id, id)).for('share');
    if (!speaker || speaker.hidden || speaker.mergedIntoId || !speaker.name?.trim()) {
      throw new BadRequestException('Choose an available named person.');
    }
    return { saidByPersonId: speaker.id, saidByLabel: speaker.name };
  }

  private async project(db: Database | Transaction, assetId: string): Promise<AssetCaption[]> {
    const rows = await db.select({ caption: assetCaption, speaker: person }).from(assetCaption)
      .leftJoin(person, eq(person.id, assetCaption.saidByPersonId)).where(eq(assetCaption.assetId, assetId))
      .orderBy(asc(assetCaption.createdAt), asc(assetCaption.id));
    return rows.map(({ caption, speaker }) => {
      const available = speaker && !speaker.hidden && !speaker.mergedIntoId && !!speaker.name?.trim();
      return {
        id: caption.id, text: caption.text,
        saidByPersonId: available ? speaker.id : null,
        saidByLabel: available ? speaker.name : caption.saidByLabel,
        createdAt: caption.createdAt.toISOString(), updatedAt: caption.updatedAt.toISOString(),
      };
    });
  }
}
