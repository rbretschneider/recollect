import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, inArray, lt, or, sql } from 'drizzle-orm';
import { access, stat } from 'fs/promises';
import { join, resolve } from 'path';
import { DATABASE } from '../database/database.module';
import type { Database } from '../database/database.module';
import { asset, assetFile, deviceOwner, favorite, geocodeCache, libraryRoot } from '../database/schema';
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
  /** Whether the requesting user has hearted this photo. */
  isFavorite: boolean;
  // Card-view metadata (PhotoPrism-style details under each photo).
  mime: string;
  cameraMake: string | null;
  cameraModel: string | null;
  lensModel: string | null;
  iso: number | null;
  exposureTime: string | null;
  fNumber: number | null;
  focalLength35: number | null;
  /** Who took it, per the camera→owner mapping in Settings. */
  takenBy: string | null;
  fileName: string | null;
  /** Folder holding the file, relative to its library root. */
  folder: string | null;
  sizeBytes: number | null;
  /** Reverse-geocoded place, e.g. "Topsham, Maine, United States". */
  place: string | null;
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
  /** Library root the file lives in — lets the UI link into the folders view. */
  rootId: string | null;
  sizeBytes: number | null;
  hasThumbnail: boolean;
  /** Whether the requesting user has hearted this photo. */
  isFavorite: boolean;
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

  async listTimeline(
    cursorToken: string | undefined,
    limit: number | undefined,
    userId: string,
    favoritesOnly = false,
  ): Promise<TimelinePage> {
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
        favoritedAt: favorite.createdAt,
        mime: asset.mime,
        cameraMake: asset.cameraMake,
        cameraModel: asset.cameraModel,
        lensModel: asset.lensModel,
        iso: asset.iso,
        exposureTime: asset.exposureTime,
        fNumber: asset.fNumber,
        focalLength35: asset.focalLength35,
        place: geocodeCache.label,
      })
      .from(asset)
      .leftJoin(favorite, and(eq(favorite.assetId, asset.id), eq(favorite.userId, userId)))
      .leftJoin(geocodeCache, eq(geocodeCache.cellKey, asset.geocodeCellKey))
      .where(
        and(
          eq(asset.status, 'active'),
          cursorFilter,
          favoritesOnly ? sql`${favorite.userId} is not null` : sql`true`,
        ),
      )
      .orderBy(desc(asset.capturedAt), desc(asset.id))
      .limit(pageSize + 1);

    const hasMore = rows.length > pageSize;
    const items = rows.slice(0, pageSize);
    const last = items[items.length - 1];
    const [fileByAsset, ownerByDevice] = await Promise.all([
      this.loadFilesFor(items.map((row) => row.id)),
      this.loadDeviceOwners(),
    ]);
    return {
      items: items.map((row) => {
        const file = fileByAsset.get(row.id);
        const segments = file?.relPath.split('/') ?? [];
        return {
          id: row.id,
          mediaType: row.mediaType as 'image' | 'video',
          capturedAt: row.capturedAt.toISOString(),
          capturedDay: row.capturedDay,
          width: row.width,
          height: row.height,
          durationMs: row.durationMs,
          hasThumbnail: row.stageThumbsAt !== null,
          isFavorite: row.favoritedAt !== null,
          mime: row.mime,
          cameraMake: row.cameraMake,
          cameraModel: row.cameraModel,
          lensModel: row.lensModel,
          iso: row.iso,
          exposureTime: row.exposureTime,
          fNumber: row.fNumber,
          focalLength35: row.focalLength35,
          place: row.place,
          takenBy:
            row.cameraMake !== null || row.cameraModel !== null
              ? (ownerByDevice.get(`${row.cameraMake ?? ''} ${row.cameraModel ?? ''}`) ?? null)
              : null,
          fileName: segments.at(-1) ?? null,
          folder: segments.length > 1 ? segments.slice(0, -1).join('/') : null,
          sizeBytes: file?.sizeBytes ?? null,
        };
      }),
      nextCursor:
        hasMore && last ? encodeTimelineCursor({ capturedAt: last.capturedAt, id: last.id }) : null,
    };
  }

  /** One present file per asset (a duplicated photo has several; any one will do). */
  private async loadFilesFor(
    assetIds: string[],
  ): Promise<Map<string, { relPath: string; sizeBytes: number | null }>> {
    if (assetIds.length === 0) {
      return new Map();
    }
    const files = await this.db
      .selectDistinctOn([assetFile.assetId], {
        assetId: assetFile.assetId,
        relPath: assetFile.relPath,
        sizeBytes: assetFile.sizeBytes,
      })
      .from(assetFile)
      .where(and(inArray(assetFile.assetId, assetIds), eq(assetFile.state, 'present')));
    return new Map(
      files.map((file) => [file.assetId, { relPath: file.relPath, sizeBytes: file.sizeBytes }]),
    );
  }

  /** Camera→owner labels keyed by "make model" (small table; loaded whole). */
  private async loadDeviceOwners(): Promise<Map<string, string>> {
    const owners = await this.db.select().from(deviceOwner);
    return new Map(
      owners.map((owner) => [`${owner.cameraMake} ${owner.cameraModel}`, owner.ownerName]),
    );
  }

  /** Detail for one asset: metadata plus camera info for the viewer's info sheet. */
  async getDetail(assetId: string, userId?: string): Promise<AssetDetail> {
    // Independent lookups run together — one round-trip time, not three.
    const [[row], [heart], [file]] = await Promise.all([
      this.db.select().from(asset).where(eq(asset.id, assetId)).limit(1),
      userId
        ? this.db
            .select({ assetId: favorite.assetId })
            .from(favorite)
            .where(and(eq(favorite.assetId, assetId), eq(favorite.userId, userId)))
            .limit(1)
        : Promise.resolve([]),
      this.db
        .select({
          relPath: assetFile.relPath,
          rootId: assetFile.rootId,
          sizeBytes: assetFile.sizeBytes,
        })
        .from(assetFile)
        .where(and(eq(assetFile.assetId, assetId), eq(assetFile.state, 'present')))
        .limit(1),
    ]);
    if (!row) {
      throw new NotFoundException('That photo does not exist.');
    }
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
      rootId: file?.rootId ?? null,
      sizeBytes: file?.sizeBytes ?? null,
      hasThumbnail: row.stageThumbsAt !== null,
      isFavorite: heart !== undefined,
      stageErrors: row.stageErrors as Record<string, string> | null,
    };
  }

  /** Timeline-shaped rows for an explicit id set (album/memory viewers). */
  async getTimelineItems(assetIds: string[], userId: string): Promise<TimelineAsset[]> {
    if (assetIds.length === 0) {
      return [];
    }
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
        favoritedAt: favorite.createdAt,
        mime: asset.mime,
      })
      .from(asset)
      .leftJoin(favorite, and(eq(favorite.assetId, asset.id), eq(favorite.userId, userId)))
      .where(inArray(asset.id, assetIds));
    const byId = new Map(rows.map((row) => [row.id, row]));
    // Preserve the caller's ordering (album sort order, memory order).
    return assetIds.flatMap((id) => {
      const row = byId.get(id);
      if (!row) {
        return [];
      }
      return [
        {
          id: row.id,
          mediaType: row.mediaType as 'image' | 'video',
          capturedAt: row.capturedAt.toISOString(),
          capturedDay: row.capturedDay,
          width: row.width,
          height: row.height,
          durationMs: row.durationMs,
          hasThumbnail: row.stageThumbsAt !== null,
          isFavorite: row.favoritedAt !== null,
          mime: row.mime,
          cameraMake: null,
          cameraModel: null,
          lensModel: null,
          iso: null,
          exposureTime: null,
          fNumber: null,
          focalLength35: null,
          takenBy: null,
          fileName: null,
          folder: null,
          sizeBytes: null,
          place: null,
        },
      ];
    });
  }

  /** Hearts or un-hearts a photo for one user (personal, never shared). */
  async setFavorite(userId: string, assetId: string, on: boolean): Promise<void> {
    const [exists] = await this.db
      .select({ id: asset.id })
      .from(asset)
      .where(eq(asset.id, assetId))
      .limit(1);
    if (!exists) {
      throw new NotFoundException('That photo does not exist.');
    }
    if (on) {
      await this.db
        .insert(favorite)
        .values({ userId, assetId })
        .onConflictDoNothing({ target: [favorite.userId, favorite.assetId] });
      return;
    }
    await this.db
      .delete(favorite)
      .where(and(eq(favorite.userId, userId), eq(favorite.assetId, assetId)));
  }

  /**
   * A human-friendly, unique download name: capture date/time, who took it
   * (camera→owner mapping), and a short id for uniqueness. When ML tagging
   * lands, tags join this same name.
   */
  async getDownloadName(assetId: string): Promise<string> {
    const [row] = await this.db
      .select({
        capturedAt: asset.capturedAt,
        cameraMake: asset.cameraMake,
        cameraModel: asset.cameraModel,
        relPath: assetFile.relPath,
      })
      .from(asset)
      .leftJoin(
        assetFile,
        and(eq(assetFile.assetId, asset.id), eq(assetFile.state, 'present')),
      )
      .where(eq(asset.id, assetId))
      .limit(1);
    if (!row) {
      throw new NotFoundException('That photo does not exist.');
    }
    const owners = await this.loadDeviceOwners();
    const takenBy =
      row.cameraMake !== null || row.cameraModel !== null
        ? owners.get(`${row.cameraMake ?? ''} ${row.cameraModel ?? ''}`)
        : undefined;
    const stamp = row.capturedAt
      .toISOString()
      .slice(0, 16)
      .replace('T', '_')
      .replace(':', '');
    const extension = row.relPath?.match(/\.[A-Za-z0-9]+$/)?.[0]?.toLowerCase() ?? '';
    const ownerPart = takenBy ? `_${takenBy.replace(/[^\p{L}\p{N}]+/gu, '-')}` : '';
    return `${stamp}${ownerPart}_${assetId.slice(0, 6)}${extension}`;
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
