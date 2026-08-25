import { Injectable, OnModuleInit } from '@nestjs/common';
import { JobHandler, JobHandlerRegistry } from '../../jobs/job-handler';
import { SCAN_ROOT_JOB } from '../library-job-types';
import { ScannerService } from '../scanner.service';

/** Runs a library-root scan as a background job. */
@Injectable()
export class ScanRootHandler implements JobHandler, OnModuleInit {
  readonly type = SCAN_ROOT_JOB;

  constructor(
    private readonly registry: JobHandlerRegistry,
    private readonly scanner: ScannerService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async handle(payload: unknown): Promise<void> {
    const { rootId } = payload as { rootId: string };
    await this.scanner.scanRoot(rootId);
  }
}
