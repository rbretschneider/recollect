import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { and, eq } from 'drizzle-orm';
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import { basename, join } from 'path';
import { pipeline } from 'stream/promises';
import { v7 as uuidv7 } from 'uuid';
import { DATABASE } from '../database/database.module';
import type { Database } from '../database/database.module';
import { asset, assetFile, assetMetadata, libraryRoot } from '../database/schema';
import { toCapturedDay } from '../media/captured-day';
import { classifyMediaFile, MediaTypeInfo } from '../media/media-types';
import { ExtractedMetadata, MetadataExtractorService } from '../media/metadata-extractor.service';
import { MotionPhotoService } from '../media/motion-photo.service';
import { ThumbnailService } from '../media/thumbnail.service';
import { DETECT_EVENTS_JOB } from '../memories/handlers/detect-events.handler';
import { JobQueueService } from '../jobs/job-queue.service';
import { TRANSCODE_PLAYBACK_JOB } from '../assets/assets.service';
import { isWebSafeVideoCodec } from '../media/transcode.service';
import { MlClientService } from '../ml/ml-client.service';
import { DETECT_FACES_JOB, EMBED_CLIP_JOB, ML_JOB_PRIORITY } from '../people/people-job-types';
import { TRANSCODE_BACKGROUND_PRIORITY } from './library-job-types';
import { IngestFilePayload } from './scanner.service';

/**
 * Processes one discovered file: content hash (the durable identity), metadata
 * extraction, and thumbnail generation. A failed stage is recorded on the asset
 * but never prevents the photo from appearing (FRD story S3.4).
 */
@Injectable()
export class IngestService {
  private readonly logger = new Logger(IngestService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly extractor: MetadataExtractorService,
    private readonly thumbnails: ThumbnailService,
    private readonly queue: JobQueueService,
    private readonly ml: MlClientService,
    private readonly motion: MotionPhotoService,
  ) {}

  async ingestFile(payload: IngestFilePayload): Promise<void> {
    const absolutePath = await this.resolveAbsolutePath(payload);
    const typeInfo = classifyMediaFile(basename(payload.relPath));
    if (!typeInfo) {
      return;
    }
    const stats = await stat(absolutePath);
    const contentHash = await this.hashFile(absolutePath);

    const existing = await this.findAssetByHash(contentHash);
    const assetId =
      existing?.id ??
      (await this.createAsset(contentHash, typeInfo, absolutePath, stats.mtime));
    await this.linkFile(payload, assetId, stats);
    // A file moved on disk re-links here; restore the asset if a scan marked it missing.
    await this.recomputeAssetStatus(assetId);
    // Run thumbnails for new assets AND for existing ones still missing them —
    // a job that failed mid-thumbnail must not skip the stage forever on retry.
    if (!existing || existing.stageThumbsAt === null) {
      await this.runThumbnailStage(assetId, absolutePath, typeInfo);
    }
    if (!existing) {
      await this.queuePlaybackTranscodeIfNeeded(assetId);
      await this.queueMlStages(assetId, typeInfo);
    }
    // Same priority as ingest with a short delay: during a large import,
    // detection interleaves every ~90s so suggestions appear while indexing
    // runs, instead of being starved until the whole queue drains.
    await this.queue.enqueue(
      DETECT_EVENTS_JOB,
      {},
      {
        dedupeKey: DETECT_EVENTS_JOB,
        priority: 100,
        runAt: new Date(Date.now() + 90 * 1000),
      },
    );
  }

  private async resolveAbsolutePath(payload: IngestFilePayload): Promise<string> {
    const [root] = await this.db
      .select({ path: libraryRoot.path })
      .from(libraryRoot)
      .where(eq(libraryRoot.id, payload.rootId))
      .limit(1);
    if (!root) {
      throw new NotFoundException(`Library root ${payload.rootId} does not exist.`);
    }
    return join(root.path, payload.relPath);
  }

  private async hashFile(absolutePath: string): Promise<string> {
    const hash = createHash('sha256');
    await pipeline(createReadStream(absolutePath), hash);
    return hash.digest('hex');
  }

  private async findAssetByHash(
    contentHash: string,
  ): Promise<{ id: string; stageThumbsAt: Date | null } | null> {
    const [row] = await this.db
      .select({ id: asset.id, stageThumbsAt: asset.stageThumbsAt })
      .from(asset)
      .where(eq(asset.contentHash, contentHash))
      .limit(1);
    return row ?? null;
  }

  /** Creates the asset row with extracted metadata (or mtime-only fallback on failure). */
  private async createAsset(
    contentHash: string,
    typeInfo: MediaTypeInfo,
    absolutePath: string,
    fileMtime: Date,
  ): Promise<string> {
    const assetId = uuidv7();
    const metadata = await this.extractSafely(absolutePath, typeInfo, fileMtime);
    await this.db.insert(asset).values({
      id: assetId,
      contentHash,
      mediaType: typeInfo.mediaType,
      mime: typeInfo.mime,
      width: metadata?.width ?? null,
      height: metadata?.height ?? null,
      durationMs: metadata?.durationMs ?? null,
      orientation: metadata?.orientation ?? null,
      capturedAt: metadata?.capturedAt ?? fileMtime,
      capturedTzOffsetMin: metadata?.capturedTzOffsetMin ?? -fileMtime.getTimezoneOffset(),
      capturedAtSource: metadata?.capturedAtSource ?? 'file_mtime',
      capturedDay: toCapturedDay(
        metadata?.capturedAt ?? fileMtime,
        metadata?.capturedTzOffsetMin ?? -fileMtime.getTimezoneOffset(),
      ),
      gpsLat: metadata?.gpsLat ?? null,
      gpsLon: metadata?.gpsLon ?? null,
      gpsAltM: metadata?.gpsAltM ?? null,
      videoCodec: metadata?.videoCodec ?? null,
      cameraMake: metadata?.cameraMake ?? null,
      cameraModel: metadata?.cameraModel ?? null,
      lensModel: metadata?.lensModel ?? null,
      iso: metadata?.iso ?? null,
      exposureTime: metadata?.exposureTime ?? null,
      fNumber: metadata?.fNumber ?? null,
      focalLength35: metadata?.focalLength35 ?? null,
      stageMetadataAt: metadata ? new Date() : null,
      stageErrors: metadata ? null : { metadata: 'extraction failed' },
    });
    if (metadata) {
      await this.db
        .insert(assetMetadata)
        .values({ assetId, raw: metadata.raw })
        .onConflictDoNothing();
      // Garnish: cache the embedded motion clip if this is a motion photo.
      // Best-effort — the still is already stored regardless of the outcome.
      if (typeInfo.mediaType === 'image') {
        const hasMotion = await this.motion.extractIfPresent(assetId, absolutePath, metadata.raw);
        if (hasMotion) {
          // Persist the flag so the grid can badge it without a per-tile file stat.
          await this.db
            .update(asset)
            .set({ motionPhoto: true })
            .where(eq(asset.id, assetId));
        }
      }
    }
    return assetId;
  }

  private async extractSafely(
    absolutePath: string,
    typeInfo: MediaTypeInfo,
    fileMtime: Date,
  ): Promise<ExtractedMetadata | null> {
    try {
      return await this.extractor.extract(absolutePath, typeInfo, fileMtime);
    } catch (error) {
      this.logger.warn(`Metadata extraction failed for ${absolutePath}: ${(error as Error).message}`);
      return null;
    }
  }

  /** Upserts the physical file record; re-links the path if its content changed. */
  private async linkFile(
    payload: IngestFilePayload,
    assetId: string,
    stats: { size: number; mtime: Date },
  ): Promise<void> {
    const previous = await this.findPreviousLink(payload);
    await this.db
      .insert(assetFile)
      .values({
        id: uuidv7(),
        assetId,
        rootId: payload.rootId,
        relPath: payload.relPath,
        fileName: basename(payload.relPath),
        sizeBytes: stats.size,
        fsMtime: stats.mtime,
        state: 'present',
      })
      .onConflictDoUpdate({
        target: [assetFile.rootId, assetFile.relPath],
        set: {
          assetId,
          sizeBytes: stats.size,
          fsMtime: stats.mtime,
          state: 'present',
          lastVerifiedAt: new Date(),
        },
      });
    if (previous && previous.assetId !== assetId) {
      await this.recomputeAssetStatus(previous.assetId);
    }
  }

  private async findPreviousLink(payload: IngestFilePayload): Promise<{ assetId: string } | null> {
    const [row] = await this.db
      .select({ assetId: assetFile.assetId })
      .from(assetFile)
      .where(and(eq(assetFile.rootId, payload.rootId), eq(assetFile.relPath, payload.relPath)))
      .limit(1);
    return row ?? null;
  }

  private async runThumbnailStage(
    assetId: string,
    absolutePath: string,
    typeInfo: MediaTypeInfo,
  ): Promise<void> {
    try {
      const dimensions = await this.thumbnails.generateAll(assetId, absolutePath, typeInfo);
      await this.db
        .update(asset)
        .set({
          stageThumbsAt: new Date(),
          width: dimensions.width || undefined,
          height: dimensions.height || undefined,
          updatedAt: new Date(),
        })
        .where(eq(asset.id, assetId));
    } catch (error) {
      this.logger.warn(`Thumbnailing failed for ${absolutePath}: ${(error as Error).message}`);
      await this.db
        .update(asset)
        .set({ stageErrors: { thumbs: (error as Error).message }, updatedAt: new Date() })
        .where(eq(asset.id, assetId));
    }
  }

  /** Full status derivation (data-model.md §3.2): present → active, else trashed → trashed, else missing. */
  /**
   * Re-runs metadata extraction and thumbnailing for one existing asset
   * (user-triggered retry after a failure, or after a pipeline fix).
   * User-corrected capture times are never overwritten (data-model.md §5.3).
   */
  async reprocessAsset(assetId: string): Promise<void> {
    const [row] = await this.db
      .select({
        id: asset.id,
        capturedAtSource: asset.capturedAtSource,
        relPath: assetFile.relPath,
        rootPath: libraryRoot.path,
      })
      .from(asset)
      .innerJoin(assetFile, and(eq(assetFile.assetId, asset.id), eq(assetFile.state, 'present')))
      .innerJoin(libraryRoot, eq(libraryRoot.id, assetFile.rootId))
      .where(eq(asset.id, assetId))
      .limit(1);
    if (!row) {
      throw new NotFoundException('That item has no present file to reprocess.');
    }
    const absolutePath = join(row.rootPath, row.relPath);
    const typeInfo = classifyMediaFile(basename(row.relPath));
    if (!typeInfo) {
      return;
    }
    await this.db
      .update(asset)
      .set({ stageErrors: null, updatedAt: new Date() })
      .where(eq(asset.id, assetId));
    const stats = await stat(absolutePath);
    const metadata = await this.extractSafely(absolutePath, typeInfo, stats.mtime);
    if (metadata) {
      await this.db
        .update(asset)
        .set({
          width: metadata.width,
          height: metadata.height,
          durationMs: metadata.durationMs,
          orientation: metadata.orientation,
          gpsLat: metadata.gpsLat,
          gpsLon: metadata.gpsLon,
          gpsAltM: metadata.gpsAltM,
          videoCodec: metadata.videoCodec,
          cameraMake: metadata.cameraMake,
          cameraModel: metadata.cameraModel,
          lensModel: metadata.lensModel,
          iso: metadata.iso,
          exposureTime: metadata.exposureTime,
          fNumber: metadata.fNumber,
          focalLength35: metadata.focalLength35,
          stageMetadataAt: new Date(),
          ...(row.capturedAtSource === 'user'
            ? {}
            : {
                capturedAt: metadata.capturedAt,
                capturedTzOffsetMin: metadata.capturedTzOffsetMin,
                capturedAtSource: metadata.capturedAtSource,
                capturedDay: toCapturedDay(metadata.capturedAt, metadata.capturedTzOffsetMin),
              }),
          updatedAt: new Date(),
        })
        .where(eq(asset.id, assetId));
    }
    await this.runThumbnailStage(assetId, absolutePath, typeInfo);
    // Re-derive the motion clip too, so reprocessing an existing photo (or the
    // viewer's "Re-pull" button) picks up a motion photo the first scan missed.
    if (typeInfo.mediaType === 'image') {
      const rawTags = metadata?.raw ?? {};
      await this.motion.removeMotion(assetId);
      const hasMotion = await this.motion.extractIfPresent(assetId, absolutePath, rawTags);
      await this.db.update(asset).set({ motionPhoto: hasMotion }).where(eq(asset.id, assetId));
    }
    await this.queuePlaybackTranscodeIfNeeded(assetId);
  }

  /**
   * The last pipeline step for videos browsers can't decode: a background
   * playback transcode, behind ingest work so photos appear first. Opening
   * the video before it runs upgrades the queued job to user priority.
   */
  private async queuePlaybackTranscodeIfNeeded(assetId: string): Promise<void> {
    const [row] = await this.db
      .select({ mediaType: asset.mediaType, videoCodec: asset.videoCodec })
      .from(asset)
      .where(eq(asset.id, assetId))
      .limit(1);
    if (!row || row.mediaType !== 'video' || isWebSafeVideoCodec(row.videoCodec)) {
      return;
    }
    await this.queue.enqueue(
      TRANSCODE_PLAYBACK_JOB,
      { assetId },
      { dedupeKey: `${TRANSCODE_PLAYBACK_JOB}:${assetId}`, priority: TRANSCODE_BACKGROUND_PRIORITY },
    );
  }

  /** Faces + CLIP run last, and only for images while the ML sidecar is configured. */
  private async queueMlStages(assetId: string, typeInfo: MediaTypeInfo): Promise<void> {
    if (!this.ml.isEnabled || typeInfo.mediaType !== 'image') {
      return;
    }
    await this.queue.enqueue(
      DETECT_FACES_JOB,
      { assetId },
      { dedupeKey: `${DETECT_FACES_JOB}:${assetId}`, priority: ML_JOB_PRIORITY },
    );
    await this.queue.enqueue(
      EMBED_CLIP_JOB,
      { assetId },
      { dedupeKey: `${EMBED_CLIP_JOB}:${assetId}`, priority: ML_JOB_PRIORITY },
    );
  }

  private async recomputeAssetStatus(assetId: string): Promise<void> {
    const files = await this.db
      .select({ state: assetFile.state })
      .from(assetFile)
      .where(eq(assetFile.assetId, assetId));
    const status = files.some((file) => file.state === 'present')
      ? 'active'
      : files.some((file) => file.state === 'trashed')
        ? 'trashed'
        : 'missing';
    await this.db
      .update(asset)
      .set({ status, updatedAt: new Date() })
      .where(eq(asset.id, assetId));
  }
}
