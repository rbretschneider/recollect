import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, lt, or, sql } from 'drizzle-orm';
import { access } from 'fs/promises';
import { resolve } from 'path';
import { DATABASE } from '../database/database.module';
import type { Database } from '../database/database.module';
import { asset } from '../database/schema';
import { ThumbnailSize, ThumbnailStore } from '../media/thumbnail-store';
import { decodeTimelineCursor, encodeTimelineCursor } from './timeline-cursor';

/** A timeline item as exposed to the API (grid rendering needs only this). */
export interface TimelineAsset {
  id: string;
  mediaType: 'image' | 'video';
  capturedAt: string;
  capturedDay: string;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  hasThumbnail: boolean;
}

/** One page of the photo timeline. */
export interface TimelinePage {
  items: TimelineAsset[];
  nextCursor: string | null;
}

const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 500;

/** Read side of the photo library: timeline pages and thumbnail lookup. */
@Injectable()
export class AssetsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly thumbnailStore: ThumbnailStore,
  ) {}

  async listTimeline(cursorToken: string | undefined, limit: number | undefined): Promise<TimelinePage> {
    const pageSize = Math.min(limit ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const cursor = cursorToken ? decodeTimelineCursor(cursorToken) : null;
    const cursorFilter = cursor
      ? or(
          lt(asset.capturedAt, cursor.capturedAt),
          and(eq(asset.capturedAt, cursor.capturedAt), lt(asset.id, cursor.id)),
        )
      : sql`true`;
    const rows = await this.db
      .select({
        id: asset.id,
        mediaType: asset.mediaType,
        capturedAt: asset.capturedAt,
        capturedDay: asset.capturedDay,
        width: asset.width,
        height: asset.height,
        durationMs: asset.durationMs,
        stageThumbsAt: asset.stageThumbsAt,
      })
      .from(asset)
      .where(and(eq(asset.status, 'active'), cursorFilter))
      .orderBy(desc(asset.capturedAt), desc(asset.id))
      .limit(pageSize + 1);

    const hasMore = rows.length > pageSize;
    const items = rows.slice(0, pageSize);
    const last = items[items.length - 1];
    return {
      items: items.map((row) => ({
        id: row.id,
        mediaType: row.mediaType as 'image' | 'video',
        capturedAt: row.capturedAt.toISOString(),
        capturedDay: row.capturedDay,
        width: row.width,
        height: row.height,
        durationMs: row.durationMs,
        hasThumbnail: row.stageThumbsAt !== null,
      })),
      nextCursor:
        hasMore && last ? encodeTimelineCursor({ capturedAt: last.capturedAt, id: last.id }) : null,
    };
  }

  /** Returns the absolute on-disk path of a generated thumbnail, verifying it exists. */
  async getThumbnailPath(assetId: string, size: ThumbnailSize): Promise<string> {
    const path = resolve(this.thumbnailStore.pathFor(assetId, size));
    try {
      await access(path);
    } catch {
      throw new NotFoundException('Thumbnail is not available yet.');
    }
    return path;
  }
}
