import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, lt, or, sql } from 'drizzle-orm';
import { access } from 'fs/promises';
import { join, resolve } from 'path';
import { DATABASE } from '../database/database.module';
import type { Database } from '../database/database.module';
import { asset, assetFile, libraryRoot } from '../database/schema';
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

/** Full detail for a single asset (viewer info sheet). */
export interface AssetDetail {
  id: string;
  mediaType: 'image' | 'video';
  mime: string;
  capturedAt: string;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  cameraMake: string | null;
  cameraModel: string | null;
  lensModel: string | null;
  gpsLat: number | null;
  gpsLon: number | null;
  relPath: string | null;
  sizeBytes: number | null;
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

  /** Detail for one asset: metadata plus camera info for the viewer's info sheet. */
  async getDetail(assetId: string): Promise<AssetDetail> {
    const [row] = await this.db.select().from(asset).where(eq(asset.id, assetId)).limit(1);
    if (!row) {
      throw new NotFoundException('That photo does not exist.');
    }
    const [file] = await this.db
      .select({ relPath: assetFile.relPath, sizeBytes: assetFile.sizeBytes })
      .from(assetFile)
      .where(and(eq(assetFile.assetId, assetId), eq(assetFile.state, 'present')))
      .limit(1);
    return {
      id: row.id,
      mediaType: row.mediaType as 'image' | 'video',
      mime: row.mime,
      capturedAt: row.capturedAt.toISOString(),
      width: row.width,
      height: row.height,
      durationMs: row.durationMs,
      cameraMake: row.cameraMake,
      cameraModel: row.cameraModel,
      lensModel: row.lensModel,
      gpsLat: row.gpsLat,
      gpsLon: row.gpsLon,
      relPath: file?.relPath ?? null,
      sizeBytes: file?.sizeBytes ?? null,
    };
  }

  /** Absolute path + mime of the original file, for streaming to the viewer. */
  async getOriginalFile(assetId: string): Promise<{ path: string; mime: string }> {
    const [row] = await this.db
      .select({
        mime: asset.mime,
        relPath: assetFile.relPath,
        rootPath: libraryRoot.path,
      })
      .from(asset)
      .innerJoin(
        assetFile,
        and(eq(assetFile.assetId, asset.id), eq(assetFile.state, 'present')),
      )
      .innerJoin(libraryRoot, eq(libraryRoot.id, assetFile.rootId))
      .where(eq(asset.id, assetId))
      .limit(1);
    if (!row) {
      throw new NotFoundException('The original file is not available.');
    }
    return { path: resolve(join(row.rootPath, row.relPath)), mime: row.mime };
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
