import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { DATABASE } from '../../database/database.module';
import type { Database } from '../../database/database.module';
import { asset } from '../../database/schema';
import { JobHandler, JobHandlerRegistry } from '../../jobs/job-handler';
import { JobQueueService } from '../../jobs/job-queue.service';
import { TRANSCODE_BACKGROUND_PRIORITY } from '../../library/library-job-types';
import { isWebSafeVideoCodec } from '../../media/transcode.service';
import { TRANSCODE_PLAYBACK_JOB } from '../assets.service';

/** Job type: queue playback transcodes for every video that needs one. */
export const TRANSCODE_BACKFILL_JOB = 'transcode_backfill';

/**
 * Sweeps the library for videos browsers can't decode and queues their
 * playback transcodes (videos ingested before pre-transcoding existed, or
 * whose renditions were cleared). Per-asset dedupe makes re-runs free;
 * the transcode handler skips assets whose rendition already exists.
 */
@Injectable()
export class TranscodeBackfillHandler implements JobHandler, OnModuleInit {
  readonly type = TRANSCODE_BACKFILL_JOB;
  private readonly logger = new Logger(TranscodeBackfillHandler.name);

  constructor(
    private readonly registry: JobHandlerRegistry,
    @Inject(DATABASE) private readonly db: Database,
    private readonly queue: JobQueueService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async handle(): Promise<void> {
    const videos = await this.db
      .select({ id: asset.id, videoCodec: asset.videoCodec })
      .from(asset)
      .where(sql`${asset.mediaType} = 'video' and ${asset.status} = 'active'`);
    let queued = 0;
    for (const video of videos) {
      if (video.videoCodec !== null && !isWebSafeVideoCodec(video.videoCodec)) {
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
    }
    if (queued > 0) {
      this.logger.log(`Transcode backfill queued ${queued} videos.`);
    }
  }
}
