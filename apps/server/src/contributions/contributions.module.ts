import { Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { join } from 'path';
import { AlbumsModule } from '../albums/albums.module';
import { AssetsModule } from '../assets/assets.module';
import { APP_CONFIG } from '../config/app-config';
import type { AppConfig } from '../config/app-config';
import { LibraryModule } from '../library/library.module';
import { MediaModule } from '../media/media.module';
import { ContributionUploadGuard } from './contribution-upload.guard';
import { ContributionsController } from './contributions.controller';
import { ContributionsService } from './contributions.service';
import { PublicContributeController } from './public-contribute.controller';

/** How often orphaned staging temp files are swept. */
const STAGING_SWEEP_INTERVAL_MS = 60 * 60_000;

/** A phone video can be large; anything beyond this is not a family photo. */
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024;

@Module({
  imports: [
    AlbumsModule,
    AssetsModule,
    LibraryModule,
    MediaModule,
    // Multer streams uploads straight to disk in the staging temp dir (it
    // creates the directory itself), never buffering a 2GB video in memory.
    MulterModule.registerAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        dest: join(config.appDataDir, 'staging', 'tmp'),
        limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
      }),
    }),
  ],
  controllers: [ContributionsController, PublicContributeController],
  providers: [ContributionsService, ContributionUploadGuard],
})
export class ContributionsModule implements OnModuleInit, OnModuleDestroy {
  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly contributions: ContributionsService) {}

  async onModuleInit(): Promise<void> {
    await this.contributions.ensureStagingDir();
    // Clear anything left by an interrupted run, then keep it tidy hourly.
    await this.contributions.sweepStaging().catch(() => undefined);
    this.sweepTimer = setInterval(() => {
      void this.contributions.sweepStaging().catch(() => undefined);
    }, STAGING_SWEEP_INTERVAL_MS);
    this.sweepTimer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
    }
  }
}
