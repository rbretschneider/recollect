import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { access } from 'fs/promises';
import { DATABASE } from '../../database/database.module';
import type { Database } from '../../database/database.module';
import { asset } from '../../database/schema';
import { JobHandler, JobHandlerRegistry } from '../../jobs/job-handler';
import { JobQueueService } from '../../jobs/job-queue.service';
import { TRANSCODE_BACKGROUND_PRIORITY } from '../../library/library-job-types';
import { isWebSafeVideoCodec, TranscodeService } from '../../media/transcode.service';
import { TRANSCODE_PLAYBACK_JOB } from '../assets.service';

/** Job type: queue playback transcodes for every video that needs one. */
export const TRANSCODE_BACKFILL_JOB = 'transcode_backfill';

/**
 * Sweeps the library for videos browsers can't decode and queues their
 * playback transcodes (videos ingested before pre-transcoding existed, or
 * whose renditions were cleared).
 *
 * Videos that already HAVE a rendition are skipped here, before a job is
 * created. Dedupe only suppresses a duplicate while the earlier job is still
 * queued or running, so enqueueing regardless left a fresh row every sweep for
 * every already-transcoded video — on a real library that was thousands of
 * no-op jobs per sweep, claimed and discarded by a worker, and the single
 * biggest source of rows in the queue table.
 */
@Injectable()
export class TranscodeBackfillHandler implements JobHandler, OnModuleInit {
  readonly type = TRANSCODE_BACKFILL_JOB;
  private readonly logger = new Logger(TranscodeBackfillHandler.name);

  constructor(
    private readonly registry: JobHandlerRegistry,
    @Inject(DATABASE) private readonly db: Database,
    private readonly queue: JobQueueService,
    private readonly transcode: TranscodeService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async handle(): Promise<void> {
    const videos = await this.db
      .select({ id: asset.id, videoCodec: asset.videoCodec })
      .from(asset)
      .where(
        sql`${asset.mediaType} = 'video' and ${asset.status} = 'active'
            and (${asset.stageErrors} is null or ${asset.stageErrors} -> 'playback' is null)`,
      );
    let queued = 0;
    let alreadyDone = 0;
    for (const video of videos) {
      if (video.videoCodec === null || isWebSafeVideoCodec(video.videoCodec)) {
        continue;
      }
      // A stat is far cheaper than the row + claim + discard this would cost.
      if (await this.hasRendition(video.id)) {
        alreadyDone++;
        continue;
      }
      await this.queue.enqueue(
        TRANSCODE_PLAYBACK_JOB,
        { assetId: video.id },
        {
          dedupeKey: `${TRANSCODE_PLAYBACK_JOB}:${video.id}`,
          priority: TRANSCODE_BACKGROUND_PRIORITY,
        },
      );
      queued++;
    }
    if (queued > 0) {
      this.logger.log(
        `Transcode backfill queued ${queued} videos (${alreadyDone} already had renditions).`,
      );
    }
  }

  private async hasRendition(assetId: string): Promise<boolean> {
    try {
      await access(this.transcode.playbackPathFor(assetId));
      return true;
    } catch {
      return false;
    }
  }
}
