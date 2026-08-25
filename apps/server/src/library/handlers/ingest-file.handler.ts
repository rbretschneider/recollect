import { Injectable, OnModuleInit } from '@nestjs/common';
import { JobHandler, JobHandlerRegistry } from '../../jobs/job-handler';
import { IngestService } from '../ingest.service';
import { INGEST_FILE_JOB } from '../library-job-types';
import { IngestFilePayload } from '../scanner.service';

/** Runs single-file ingest (hash → metadata → thumbnails) as a background job. */
@Injectable()
export class IngestFileHandler implements JobHandler, OnModuleInit {
  readonly type = INGEST_FILE_JOB;

  constructor(
    private readonly registry: JobHandlerRegistry,
    private readonly ingest: IngestService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async handle(payload: unknown): Promise<void> {
    await this.ingest.ingestFile(payload as IngestFilePayload);
  }
}
