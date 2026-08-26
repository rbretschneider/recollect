import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { AlbumsService } from '../albums/albums.service';
import { DATABASE } from '../database/database.module';
import type { Database } from '../database/database.module';
import { shareLink } from '../database/schema';
import { MemoriesService } from '../memories/memories.service';

/** What a share link points at. */
export type ShareTargetType = 'memory' | 'album';

/** An active share link as shown to its owner. */
export interface ShareLinkView {
  id: string;
  token: string;
  includeJournal: boolean;
  createdAt: string;
  expiresAt: string | null;
  viewCount: number;
}

/** The public payload rendered for anyone opening a share link. */
export interface SharedView {
  targetType: ShareTargetType;
  title: string;
  description: string | null;
  startAt: string | null;
  endAt: string | null;
  assetIds: string[];
  journal: Array<{ authorName: string; bodyMd: string }>;
}

const TOKEN_BYTES = 24;

/** Tokened public links to memories and albums (FRD story S14.2). */
@Injectable()
export class SharingService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly memories: MemoriesService,
    private readonly albums: AlbumsService,
  ) {}

  /** Creates a link after verifying the target exists. Expiry is the caller's explicit choice. */
  async createLink(
    targetType: ShareTargetType,
    targetId: string,
    userId: string,
    includeJournal: boolean,
    expiresAt: Date | null,
  ): Promise<ShareLinkView> {
    await this.loadTargetAssetIds(targetType, targetId);
    const [row] = await this.db
      .insert(shareLink)
      .values({
        id: uuidv7(),
        token: randomBytes(TOKEN_BYTES).toString('base64url'),
        targetType,
        targetId,
        includeJournal,
        expiresAt,
        createdBy: userId,
      })
      .returning();
    return this.toView(row);
  }

  /** Active links for one target (so the UI reuses instead of multiplying links). */
  async listLinksFor(targetType: ShareTargetType, targetId: string): Promise<ShareLinkView[]> {
    const rows = await this.db
      .select()
      .from(shareLink)
      .where(
        and(
          eq(shareLink.targetType, targetType),
          eq(shareLink.targetId, targetId),
          isNull(shareLink.revokedAt),
        ),
      );
    return rows.map((row) => this.toView(row));
  }

  async revoke(linkId: string): Promise<void> {
    await this.db
      .update(shareLink)
      .set({ revokedAt: new Date() })
      .where(eq(shareLink.id, linkId));
  }

  /** Resolves a public token into its view payload; counts the view. */
  async getSharedView(token: string): Promise<SharedView> {
    const link = await this.requireActiveLink(token);
    await this.db
      .update(shareLink)
      .set({ viewCount: sql`${shareLink.viewCount} + 1` })
      .where(eq(shareLink.id, link.id));
    if (link.targetType === 'memory') {
      const detail = await this.memories.getDetail(link.targetId);
      return {
        targetType: 'memory',
        title: detail.title,
        description: detail.description,
        startAt: detail.startAt,
        endAt: detail.endAt,
        assetIds: detail.assetIds,
        journal: link.includeJournal
          ? detail.journal.map((entry) => ({ authorName: entry.authorName, bodyMd: entry.bodyMd }))
          : [],
      };
    }
    const detail = await this.albums.getDetail(link.targetId);
    return {
      targetType: 'album',
      title: detail.title,
      description: detail.description,
      startAt: null,
      endAt: null,
      assetIds: detail.assetIds,
      journal: [],
    };
  }

  /** Guards public media endpoints: the asset must belong to the shared target. */
  async assertAssetShared(token: string, assetId: string): Promise<void> {
    const link = await this.requireActiveLink(token);
    const assetIds = await this.loadTargetAssetIds(link.targetType as ShareTargetType, link.targetId);
    if (!assetIds.includes(assetId)) {
      throw new ForbiddenException('That photo is not part of this share.');
    }
  }

  private async requireActiveLink(token: string): Promise<typeof shareLink.$inferSelect> {
    const [row] = await this.db
      .select()
      .from(shareLink)
      .where(and(eq(shareLink.token, token), isNull(shareLink.revokedAt)))
      .limit(1);
    if (!row || (row.expiresAt !== null && row.expiresAt.getTime() < Date.now())) {
      throw new NotFoundException('This link is no longer available.');
    }
    return row;
  }

  private async loadTargetAssetIds(
    targetType: ShareTargetType,
    targetId: string,
  ): Promise<string[]> {
    if (targetType === 'memory') {
      return (await this.memories.getDetail(targetId)).assetIds;
    }
    return (await this.albums.getDetail(targetId)).assetIds;
  }

  private toView(row: typeof shareLink.$inferSelect): ShareLinkView {
    return {
      id: row.id,
      token: row.token,
      includeJournal: row.includeJournal,
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt?.toISOString() ?? null,
      viewCount: row.viewCount,
    };
  }
}
