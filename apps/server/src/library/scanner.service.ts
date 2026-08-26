import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { Dirent } from 'fs';
import { readdir, stat } from 'fs/promises';
import { basename, join, relative } from 'path';
import { DATABASE } from '../database/database.module';
import type { Database } from '../database/database.module';
import { asset, assetFile, libraryRoot } from '../database/schema';
import { JobQueueService } from '../jobs/job-queue.service';
import { classifyMediaFile } from '../media/media-types';
import { DETECT_EVENTS_JOB } from '../memories/handlers/detect-events.handler';
import { TRANSCODE_BACKFILL_JOB } from '../assets/handlers/transcode-backfill.handler';
import { REPROCESS_ASSET_JOB } from './handlers/reprocess-asset.handler';
import { MlClientService } from '../ml/ml-client.service';
import { DETECT_FACES_JOB, EMBED_CLIP_JOB, ML_JOB_PRIORITY } from '../people/people-job-types';
import { PURGE_TRASH_JOB } from '../trash/handlers/purge-trash.handler';
import { INGEST_FILE_JOB } from './library-job-types';
import { classifyScannedFile, isExcludedDirectory, KnownFileState } from './scan-classifier';

/** Payload for an ingest_file job. */
export interface IngestFilePayload {
  rootId: string;
  relPath: string;
}

/**
 * Walks a library root in place, compares what it finds against known files
 * (size/mtime fast path), enqueues ingest jobs for new/changed media, and marks
 * files that disappeared as missing. Never copies or modifies originals.
 */
@Injectable()
export class ScannerService {
  private readonly logger = new Logger(ScannerService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly queue: JobQueueService,
    private readonly ml: MlClientService,
  ) {}

  /** Scans one root; returns counts of what was enqueued and reconciled. */
  async scanRoot(rootId: string): Promise<{ enqueued: number; missing: number }> {
    const root = await this.loadRoot(rootId);
    await this.db
      .update(libraryRoot)
      .set({ lastScanStartedAt: new Date() })
      .where(eq(libraryRoot.id, rootId));

    const known = await this.loadKnownFiles(rootId);
    const seen = new Set<string>();
    const enqueued = await this.walkAndEnqueue(root.path, root.excludeGlobs, rootId, known, seen);
    const missing = await this.reconcileMissing(rootId, known, seen);

    await this.db
      .update(libraryRoot)
      .set({ lastScanCompletedAt: new Date(), lastScanEnqueued: enqueued })
      .where(eq(libraryRoot.id, rootId));
    // Scans run on a schedule, so this keeps the holding period enforced daily.
    await this.queue.enqueue(PURGE_TRASH_JOB, {}, { dedupeKey: PURGE_TRASH_JOB, priority: 250 });
    // A prompt detection pass once the scan itself is done.
    await this.queue.enqueue(DETECT_EVENTS_JOB, {}, { dedupeKey: DETECT_EVENTS_JOB, priority: 100 });
    // Sweep for videos still missing playback renditions (pre-transcode era, etc).
    await this.queue.enqueue(
      TRANSCODE_BACKFILL_JOB,
      {},
      { dedupeKey: TRANSCODE_BACKFILL_JOB, priority: 140 },
    );
    await this.queueThumbnailRepairs();
    await this.queueMlBackfill();
    this.logger.log(`Scan of ${root.path}: ${enqueued} enqueued, ${missing} missing.`);
    return { enqueued, missing };
  }

  private async loadRoot(rootId: string): Promise<typeof libraryRoot.$inferSelect> {
    const [root] = await this.db
      .select()
      .from(libraryRoot)
      .where(eq(libraryRoot.id, rootId))
      .limit(1);
    if (!root) {
      throw new NotFoundException(`Library root ${rootId} does not exist.`);
    }
    return root;
  }

  private async loadKnownFiles(rootId: string): Promise<Map<string, KnownFileState>> {
    const rows = await this.db
      .select({
        relPath: assetFile.relPath,
        sizeBytes: assetFile.sizeBytes,
        fsMtime: assetFile.fsMtime,
        state: assetFile.state,
      })
      .from(assetFile)
      .where(eq(assetFile.rootId, rootId));
    const known = new Map<string, KnownFileState>();
    for (const row of rows) {
      if (row.state === 'present') {
        known.set(row.relPath, { sizeBytes: row.sizeBytes, fsMtimeMs: row.fsMtime.getTime() });
      }
    }
    return known;
  }

  private async walkAndEnqueue(
    rootPath: string,
    excludes: readonly string[],
    rootId: string,
    known: Map<string, KnownFileState>,
    seen: Set<string>,
  ): Promise<number> {
    let enqueued = 0;
    const pending: string[] = [rootPath];
    while (pending.length > 0) {
      const directory = pending.pop() as string;
      const entries = await this.readDirectorySafely(directory);
      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (!isExcludedDirectory(entry.name, excludes)) {
            pending.push(join(directory, entry.name));
          }
          continue;
        }
        if (await this.processFile(rootPath, join(directory, entry.name), rootId, known, seen)) {
          enqueued++;
        }
      }
    }
    return enqueued;
  }

  /** Returns true when the file was enqueued for ingest. */
  private async processFile(
    rootPath: string,
    absolutePath: string,
    rootId: string,
    known: Map<string, KnownFileState>,
    seen: Set<string>,
  ): Promise<boolean> {
    if (!classifyMediaFile(basename(absolutePath))) {
      return false;
    }
    const relPath = relative(rootPath, absolutePath).replaceAll('\\', '/');
    seen.add(relPath);
    const stats = await stat(absolutePath);
    const verdict = classifyScannedFile(known.get(relPath), {
      sizeBytes: stats.size,
      fsMtimeMs: stats.mtime.getTime(),
    });
    if (verdict === 'unchanged') {
      return false;
    }
    const payload: IngestFilePayload = { rootId, relPath };
    await this.queue.enqueue(INGEST_FILE_JOB, payload, {
      dedupeKey: `${INGEST_FILE_JOB}:${rootId}:${relPath}`,
    });
    return true;
  }

  /** Marks known files that vanished from disk as missing and recomputes their assets. */
  private async reconcileMissing(
    rootId: string,
    known: Map<string, KnownFileState>,
    seen: Set<string>,
  ): Promise<number> {
    const vanished = [...known.keys()].filter((relPath) => !seen.has(relPath));
    if (vanished.length === 0) {
      return 0;
    }
    const affected = await this.db
      .update(assetFile)
      .set({ state: 'missing' })
      .where(and(eq(assetFile.rootId, rootId), inArray(assetFile.relPath, vanished)))
      .returning({ assetId: assetFile.assetId });
    await this.recomputeAssetStatuses([...new Set(affected.map((row) => row.assetId))]);
    return vanished.length;
  }

  private async recomputeAssetStatuses(assetIds: string[]): Promise<void> {
    for (const assetId of assetIds) {
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

  /**
   * Assets that never got thumbnails (failed stage, or a job that died
   * mid-run) are re-queued for processing after every scan — a scan can't
   * re-ingest them (their files are unchanged), so they need this sweep.
   */
  private async queueThumbnailRepairs(): Promise<void> {
    const broken = await this.db
      .select({ id: asset.id })
      .from(asset)
      .where(sql`${asset.status} = 'active' and ${asset.stageThumbsAt} is null`)
      .limit(500);
    for (const row of broken) {
      await this.queue.enqueue(
        REPROCESS_ASSET_JOB,
        { assetId: row.id },
        { dedupeKey: `${REPROCESS_ASSET_JOB}:${row.id}`, priority: 130 },
      );
    }
    if (broken.length > 0) {
      this.logger.log(`Queued thumbnail repair for ${broken.length} assets.`);
    }
  }

  /** Images indexed before ML existed (or after failures) get their ML stages queued. */
  private async queueMlBackfill(): Promise<void> {
    if (!this.ml.isEnabled) {
      return;
    }
    const pending = await this.db
      .select({ id: asset.id, stageFacesAt: asset.stageFacesAt, stageEmbedAt: asset.stageEmbedAt })
      .from(asset)
      .where(
        sql`${asset.status} = 'active' and ${asset.mediaType} = 'image'
            and ${asset.stageThumbsAt} is not null
            and (${asset.stageFacesAt} is null or ${asset.stageEmbedAt} is null)`,
      )
      .limit(2000);
    for (const row of pending) {
      if (row.stageFacesAt === null) {
        await this.queue.enqueue(
          DETECT_FACES_JOB,
          { assetId: row.id },
          { dedupeKey: `${DETECT_FACES_JOB}:${row.id}`, priority: ML_JOB_PRIORITY },
        );
      }
      if (row.stageEmbedAt === null) {
        await this.queue.enqueue(
          EMBED_CLIP_JOB,
          { assetId: row.id },
          { dedupeKey: `${EMBED_CLIP_JOB}:${row.id}`, priority: ML_JOB_PRIORITY },
        );
      }
    }
    if (pending.length > 0) {
      this.logger.log(`ML backfill queued for ${pending.length} assets.`);
    }
  }

  private async readDirectorySafely(directory: string): Promise<Dirent[]> {
    try {
      return await readdir(directory, { withFileTypes: true });
    } catch (error) {
      this.logger.warn(`Cannot read ${directory}: ${(error as Error).message}`);
      return [];
    }
  }
}
