import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { and, asc, eq, gt, sql } from 'drizzle-orm';
import { stat } from 'fs/promises';
import { join, resolve } from 'path';
import { DATABASE } from '../../database/database.module';
import type { Database } from '../../database/database.module';
import { asset, assetFile, libraryRoot } from '../../database/schema';
import { JobHandler, JobHandlerRegistry } from '../../jobs/job-handler';
import { JobQueueService } from '../../jobs/job-queue.service';
import { MetadataExtractorService } from '../../media/metadata-extractor.service';

/** Job type: fill iso/exposure/aperture/focal for assets ingested before they existed. */
export const EXIF_BACKFILL_JOB = 'exif_backfill';

/** Same shelf as ML: useful metadata before opportunistic transcodes (190). */
const EXIF_BACKFILL_PRIORITY = 145;

const BATCH_SIZE = 100;

interface ExifBackfillPayload {
  /** Resume cursor: process assets with id greater than this. */
  afterId?: string;
}

/**
 * One-shot sweep re-reading EXIF for existing images to fill the camera
 * settings columns (ISO, shutter, aperture, focal length) added later.
 * Self-chaining: each run does one batch and enqueues the next.
 */
@Injectable()
export class ExifBackfillHandler implements JobHandler, OnModuleInit {
  readonly type = EXIF_BACKFILL_JOB;
  private readonly logger = new Logger(ExifBackfillHandler.name);

  constructor(
    private readonly registry: JobHandlerRegistry,
    @Inject(DATABASE) private readonly db: Database,
    private readonly queue: JobQueueService,
    private readonly extractor: MetadataExtractorService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async handle(payload: unknown): Promise<void> {
    const { afterId } = (payload ?? {}) as ExifBackfillPayload;
    const rows = await this.db
      .select({
        id: asset.id,
        mime: asset.mime,
        relPath: assetFile.relPath,
        rootPath: libraryRoot.path,
      })
      .from(asset)
      .innerJoin(assetFile, and(eq(assetFile.assetId, asset.id), eq(assetFile.state, 'present')))
      .innerJoin(libraryRoot, eq(libraryRoot.id, assetFile.rootId))
      .where(
        and(
          eq(asset.mediaType, 'image'),
          eq(asset.status, 'active'),
          sql`${asset.iso} is null`,
          sql`${asset.cameraMake} is not null`,
          afterId ? gt(asset.id, afterId) : sql`true`,
        ),
      )
      .orderBy(asc(asset.id))
      .limit(BATCH_SIZE);

    let updated = 0;
    for (const row of rows) {
      try {
        const path = resolve(join(row.rootPath, row.relPath));
        const metadata = await this.extractor.extract(
          path,
          { mediaType: 'image', mime: row.mime },
          (await stat(path)).mtime,
        );
        await this.db
          .update(asset)
          .set({
            iso: metadata.iso,
            exposureTime: metadata.exposureTime,
            fNumber: metadata.fNumber,
            focalLength35: metadata.focalLength35,
            updatedAt: new Date(),
          })
          .where(eq(asset.id, row.id));
        updated++;
      } catch {
        // A missing/unreadable file just stays without camera settings.
      }
    }
    this.logger.log(`EXIF backfill: ${updated}/${rows.length} updated in this batch.`);
    const last = rows.at(-1);
    if (rows.length === BATCH_SIZE && last) {
      await this.queue.enqueue(
        EXIF_BACKFILL_JOB,
        { afterId: last.id } satisfies ExifBackfillPayload,
        { dedupeKey: `${EXIF_BACKFILL_JOB}:${last.id}`, priority: EXIF_BACKFILL_PRIORITY },
      );
    }
  }
}
