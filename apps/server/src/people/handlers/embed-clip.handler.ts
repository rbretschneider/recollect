import { Injectable, OnModuleInit } from '@nestjs/common';
import { JobHandler, JobHandlerRegistry } from '../../jobs/job-handler';
import { MlClientService } from '../../ml/ml-client.service';
import { MlProcessingService } from '../ml-processing.service';
import { EMBED_CLIP_JOB } from '../people-job-types';

/** Runs CLIP image embedding as a background job; no-op when ML is disabled. */
@Injectable()
export class EmbedClipHandler implements JobHandler, OnModuleInit {
  readonly type = EMBED_CLIP_JOB;

  constructor(
    private readonly registry: JobHandlerRegistry,
    private readonly ml: MlClientService,
    private readonly processing: MlProcessingService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async handle(payload: unknown): Promise<void> {
    if (!this.ml.isEnabled) {
      return;
    }
    await this.processing.processClipEmbedding((payload as { assetId: string }).assetId);
  }
}
