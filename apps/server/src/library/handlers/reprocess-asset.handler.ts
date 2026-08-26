import { Injectable, OnModuleInit } from '@nestjs/common';
import { JobHandler, JobHandlerRegistry } from '../../jobs/job-handler';
import { IngestService } from '../ingest.service';

/** Job type: re-run metadata + thumbnails for one asset (user-triggered retry). */
export const REPROCESS_ASSET_JOB = 'reprocess_asset';

/** Runs a single-asset reprocess as a user-priority background job. */
@Injectable()
export class ReprocessAssetHandler implements JobHandler, OnModuleInit {
  readonly type = REPROCESS_ASSET_JOB;

  constructor(
    private readonly registry: JobHandlerRegistry,
    private readonly ingest: IngestService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async handle(payload: unknown): Promise<void> {
    const { assetId } = payload as { assetId: string };
    await this.ingest.reprocessAsset(assetId);
  }
}
