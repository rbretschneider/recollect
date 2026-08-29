import { Injectable, OnModuleInit } from '@nestjs/common';
import { JobHandler, JobHandlerRegistry } from '../jobs/job-handler';
import { CleanupService, RESTORE_ORIGINAL_JOB } from './cleanup.service';

/**
 * Undoes a video conversion in the background: copies the parked original back
 * onto the NAS (a large cross-volume copy), removes the converted stand-in, and
 * re-registers the file. Kept off the request thread so the copy can't time out.
 */
@Injectable()
export class RestoreOriginalHandler implements JobHandler, OnModuleInit {
  readonly type = RESTORE_ORIGINAL_JOB;

  constructor(
    private readonly registry: JobHandlerRegistry,
    private readonly cleanup: CleanupService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async handle(payload: unknown): Promise<void> {
    const { assetId } = payload as { assetId: string };
    await this.cleanup.performRestore(assetId);
  }
}
