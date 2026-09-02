import { Module } from '@nestjs/common';
import { BackupController } from './backup.controller';
import { BackupDatabaseHandler } from './backup-database.handler';
import { BackupSchedulerService } from './backup-scheduler.service';
import { BackupService } from './backup.service';
import { RestoreService } from './restore.service';

@Module({
  controllers: [BackupController],
  providers: [BackupService, BackupDatabaseHandler, BackupSchedulerService, RestoreService],
  exports: [BackupService],
})
export class BackupModule {}
