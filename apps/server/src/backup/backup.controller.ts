import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { IsBoolean, IsIn, IsInt, IsString, Matches, Max, Min } from 'class-validator';
import { RequireAdmin } from '../auth/decorators/require-admin.decorator';
import { JobQueueService } from '../jobs/job-queue.service';
import {
  BACKUP_DATABASE_JOB,
  BackupFile,
  BackupLastRun,
  BackupService,
  BackupSettings,
} from './backup.service';

/** Body for the backup schedule + destination. */
export class BackupSettingsDto {
  @IsIn(['off', 'daily', 'weekly'])
  mode!: 'off' | 'daily' | 'weekly';

  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  time!: string;

  @IsInt()
  @Min(0)
  @Max(6)
  weekday!: number;

  /** '' keeps the server default (app-data/backups). */
  @IsString()
  directory!: string;

  @IsInt()
  @Min(1)
  @Max(60)
  keep!: number;

  @IsBoolean()
  includeMlData!: boolean;
}

/**
 * Database backups. Admin-only: this exposes where the library's written
 * history is stored and lets it be downloaded.
 */
@RequireAdmin()
@Controller('backup')
export class BackupController {
  constructor(
    private readonly backup: BackupService,
    private readonly queue: JobQueueService,
  ) {}

  @Get()
  async status(): Promise<{
    settings: BackupSettings;
    directory: string;
    lastRun: BackupLastRun | null;
    backups: BackupFile[];
  }> {
    const [settings, directory, lastRun, backups] = await Promise.all([
      this.backup.getSettings(),
      this.backup.resolveDirectory(),
      this.backup.getLastRun(),
      this.backup.listBackups(),
    ]);
    return { settings, directory, lastRun, backups };
  }

  @Post('settings')
  async setSettings(@Body() body: BackupSettingsDto): Promise<{ settings: BackupSettings }> {
    return { settings: await this.backup.setSettings(body) };
  }

  /** Runs a backup in the background; poll GET /backup for the outcome. */
  @Post('run')
  @HttpCode(HttpStatus.ACCEPTED)
  async run(): Promise<{ accepted: true }> {
    await this.queue.enqueue(
      BACKUP_DATABASE_JOB,
      { scheduled: false },
      { dedupeKey: BACKUP_DATABASE_JOB, priority: 15 },
    );
    return { accepted: true };
  }

  @Get('file/:name')
  async download(@Param('name') name: string, @Res() res: Response): Promise<void> {
    const path = await this.backup.pathForBackup(name);
    res.download(path, name, (error) => {
      if (error && !res.headersSent) {
        res.status(HttpStatus.NOT_FOUND).json({ message: 'That backup is no longer available.' });
      }
    });
  }

  @Delete('file/:name')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('name') name: string): Promise<void> {
    await this.backup.deleteBackup(name);
  }
}
