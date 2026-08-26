import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, lt, or, sql } from 'drizzle-orm';
import { access, stat } from 'fs/promises';
import { join, resolve } from 'path';
import { DATABASE } from '../database/database.module';
import type { Database } from '../database/database.module';
import { asset, assetFile, deviceOwner, libraryRoot } from '../database/schema';
import { JobQueueService } from '../jobs/job-queue.service';
import { MetadataExtractorService } from '../media/metadata-extractor.service';
import { ThumbnailSize, ThumbnailStore } from '../media/thumbnail-store';
import { isWebSafeVideoCodec, TranscodeService } from '../media/transcode.service';
import { decodeTimelineCursor, encodeTimelineCursor } from './timeline-cursor';

/** Job type: create an H.264 playback rendition for one asset. */
export const TRANSCODE_PLAYBACK_JOB = 'transcode_playback';

/** How a video should reach the browser. */
export type PlaybackResolution =
  | { kind: 'file'; path: string; mime: string }
  | { kind: 'preparing' };

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
  /** Who took it, per the camera→owner mapping in Settings. */
  takenBy: string | null;
  gpsLat: number | null;
  gpsLon: number | null;
  relPath: string | null;
  sizeBytes: number | null;
  hasThumbnail: boolean;
  /** Per-stage failure reasons, e.g. { thumbs: "unsupported format" }. */
  stageErrors: Record<string, string> | null;
}

const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 500;

/** Read side of the photo library: timeline pages and thumbnail lookup. */
@Injectable()
export class AssetsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly thumbnailStore: ThumbnailStore,
    private readonly transcode: TranscodeService,
    private readonly extractor: MetadataExtractorService,
    private readonly queue: JobQueueService,
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
    const [owner] =
      row.cameraMake !== null || row.cameraModel !== null
        ? await this.db
            .select({ ownerName: deviceOwner.ownerName })
            .from(deviceOwner)
            .where(
              and(
                eq(deviceOwner.cameraMake, row.cameraMake ?? ''),
                eq(deviceOwner.cameraModel, row.cameraModel ?? ''),
              ),
            )
            .limit(1)
        : [];
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
      takenBy: owner?.ownerName ?? null,
      gpsLat: row.gpsLat,
      gpsLon: row.gpsLon,
      relPath: file?.relPath ?? null,
      sizeBytes: file?.sizeBytes ?? null,
      hasThumbnail: row.stageThumbsAt !== null,
      stageErrors: row.stageErrors as Record<string, string> | null,
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

  /**
   * Resolves what to stream for playback: the original when the browser can
   * decode it, a cached H.264 rendition otherwise — or 'preparing' while the
   * rendition is being transcoded (queued here at user-facing priority).
   */
  async getPlayback(assetId: string): Promise<PlaybackResolution> {
    const [row] = await this.db
      .select({ mediaType: asset.mediaType, videoCodec: asset.videoCodec })
      .from(asset)
      .where(eq(asset.id, assetId))
      .limit(1);
    if (!row) {
      throw new NotFoundException('That item does not exist.');
    }
    const original = await this.getOriginalFile(assetId);
    if (row.mediaType !== 'video') {
      return { kind: 'file', ...original };
    }
    const codec = row.videoCodec ?? (await this.backfillVideoCodec(assetId, original.path));
    if (isWebSafeVideoCodec(codec)) {
      return { kind: 'file', ...original };
    }
    const renditionPath = resolve(this.transcode.playbackPathFor(assetId));
    if (await this.fileExists(renditionPath)) {
      return { kind: 'file', path: renditionPath, mime: 'video/mp4' };
    }
    await this.queue.enqueue(
      TRANSCODE_PLAYBACK_JOB,
      { assetId },
      { dedupeKey: `${TRANSCODE_PLAYBACK_JOB}:${assetId}`, priority: 20 },
    );
    return { kind: 'preparing' };
  }

  /** Assets ingested before codec extraction existed get it filled in lazily. */
  private async backfillVideoCodec(assetId: string, originalPath: string): Promise<string | null> {
    let codec: string | null = null;
    try {
      const stats = await stat(originalPath);
      const metadata = await this.extractor.extract(
        originalPath,
        { mediaType: 'video', mime: 'video/mp4' },
        stats.mtime,
      );
      codec = metadata.videoCodec;
    } catch {
      return null; // Unknown codec falls through to transcoding, the safe default.
    }
    if (codec) {
      await this.db.update(asset).set({ videoCodec: codec }).where(eq(asset.id, assetId));
    }
    return codec;
  }

  private async fileExists(path: string): Promise<boolean> {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
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
