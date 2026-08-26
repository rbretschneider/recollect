import { Injectable, OnModuleInit } from '@nestjs/common';
import { JobHandler, JobHandlerRegistry } from '../../jobs/job-handler';
import { TrashService } from '../trash.service';

/** Job type: purge trash items past the holding period. */
export const PURGE_TRASH_JOB = 'purge_trash';

/** Runs trash purging as a background job (enqueued at boot and after scans). */
@Injectable()
export class PurgeTrashHandler implements JobHandler, OnModuleInit {
  readonly type = PURGE_TRASH_JOB;

  constructor(
    private readonly registry: JobHandlerRegistry,
    private readonly trash: TrashService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async handle(): Promise<void> {
    await this.trash.purgeExpired();
  }
}
