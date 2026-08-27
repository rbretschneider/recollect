import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { access } from 'fs/promises';
import { DATABASE } from '../../database/database.module';
import type { Database } from '../../database/database.module';
import { asset } from '../../database/schema';
import { JobHandler, JobHandlerRegistry } from '../../jobs/job-handler';
import { CorruptSourceError, TranscodeService } from '../../media/transcode.service';
import { AssetsService, TRANSCODE_PLAYBACK_JOB } from '../assets.service';

/** Creates the H.264 playback rendition for one asset as a background job. */
@Injectable()
export class TranscodePlaybackHandler implements JobHandler, OnModuleInit {
  readonly type = TRANSCODE_PLAYBACK_JOB;
  private readonly logger = new Logger(TranscodePlaybackHandler.name);

  constructor(
    private readonly registry: JobHandlerRegistry,
    private readonly assets: AssetsService,
    private readonly transcode: TranscodeService,
    @Inject(DATABASE) private readonly db: Database,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async handle(payload: unknown): Promise<void> {
    const { assetId } = payload as { assetId: string };
    try {
      await access(this.transcode.playbackPathFor(assetId));
      return; // Rendition already exists — backfill re-runs are free.
    } catch {
      // Not yet rendered; proceed.
    }
    const original = await this.assets.getOriginalFile(assetId);
    try {
      await this.transcode.createPlaybackRendition(assetId, original.path);
    } catch (error) {
      if (error instanceof CorruptSourceError) {
        // The FILE is broken (interrupted recording, truncated sync). Mark it
        // on the asset so backfills stop retrying forever; the failures list
        // and the viewer's info sheet surface it in plain language.
        this.logger.warn(`Marking ${assetId} unplayable: ${error.message}`);
        await this.db
          .update(asset)
          .set({
            stageErrors: sql`coalesce(${asset.stageErrors}, '{}'::jsonb) || '{"playback": "The video file is incomplete or damaged on disk — it cannot be played or converted."}'::jsonb`,
            updatedAt: new Date(),
          })
          .where(eq(asset.id, assetId));
        return;
      }
      throw error;
    }
  }
}
