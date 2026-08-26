import { Injectable, OnModuleInit } from '@nestjs/common';
import { JobHandler, JobHandlerRegistry } from '../../jobs/job-handler';
import { TranscodeService } from '../../media/transcode.service';
import { AssetsService, TRANSCODE_PLAYBACK_JOB } from '../assets.service';

/** Creates the H.264 playback rendition for one asset as a background job. */
@Injectable()
export class TranscodePlaybackHandler implements JobHandler, OnModuleInit {
  readonly type = TRANSCODE_PLAYBACK_JOB;

  constructor(
    private readonly registry: JobHandlerRegistry,
    private readonly assets: AssetsService,
    private readonly transcode: TranscodeService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async handle(payload: unknown): Promise<void> {
    const { assetId } = payload as { assetId: string };
    const original = await this.assets.getOriginalFile(assetId);
    await this.transcode.createPlaybackRendition(assetId, original.path);
  }
}
