import { Injectable, OnModuleInit } from '@nestjs/common';
import { JobHandler, JobHandlerRegistry } from '../jobs/job-handler';
import { BACKUP_DATABASE_JOB, BackupService } from './backup.service';

/** Runs a database backup as a background job (manual or scheduled). */
@Injectable()
export class BackupDatabaseHandler implements JobHandler, OnModuleInit {
  readonly type = BACKUP_DATABASE_JOB;

  constructor(
    private readonly registry: JobHandlerRegistry,
    private readonly backup: BackupService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async handle(): Promise<void> {
    // runBackup records its own success/failure for the Settings readout, so a
    // failed backup must not also fail the job and trigger endless retries.
    await this.backup.runBackup();
  }
}
