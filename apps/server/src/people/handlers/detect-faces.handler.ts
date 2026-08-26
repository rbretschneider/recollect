import { Injectable, OnModuleInit } from '@nestjs/common';
import { JobHandler, JobHandlerRegistry } from '../../jobs/job-handler';
import { MlClientService } from '../../ml/ml-client.service';
import { MlProcessingService } from '../ml-processing.service';
import { DETECT_FACES_JOB } from '../people-job-types';

/** Runs face detection + person clustering as a background job; no-op when ML is disabled. */
@Injectable()
export class DetectFacesHandler implements JobHandler, OnModuleInit {
  readonly type = DETECT_FACES_JOB;

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
    await this.processing.processFaces((payload as { assetId: string }).assetId);
  }
}
